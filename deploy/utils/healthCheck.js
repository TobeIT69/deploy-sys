import { spawn } from "child_process";
import {
  HEALTH_CHECK,
  PORTS,
  CDN_HEALTH_CHECK,
  PUBLIC_HEALTH_CHECK,
  PUBLIC_URLS,
} from "../config.js";

export async function findAvailablePort(
  min = HEALTH_CHECK.portRange.min,
  max = HEALTH_CHECK.portRange.max
) {
  const { createServer } = await import("net");

  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > max) {
        reject(new Error(`No available ports in range ${min}-${max}`));
        return;
      }

      const server = createServer();
      server.listen(port, () => {
        server.close(() => resolve(port));
      });

      server.on("error", () => tryPort(port + 1));
    };

    tryPort(min);
  });
}

export async function startTestServer(packagePath, port, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["start"], {
      cwd: packagePath,
      env: { ...process.env, PORT: port.toString(), ...env },
      stdio: "pipe",
      detached: true, // Create new process group
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        // Kill entire process group to ensure npm and its children are terminated
        process.kill(-child.pid, "SIGTERM");
        reject(
          new Error(`Server failed to start within ${HEALTH_CHECK.timeout}ms`)
        );
      }
    }, HEALTH_CHECK.timeout);

    child.stdout.on("data", (data) => {
      const output = data.toString().toLowerCase();
      console.log(`[STDOUT] ${data.toString().trim()}`);
      if (
        output.includes("ready") ||
        output.includes("listening") ||
        output.includes("started") ||
        output.includes("server running") ||
        output.includes(`http://localhost:${port}`) ||
        output.includes(`:${port}`)
      ) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          resolve(child);
        }
      }
    });

    child.stderr.on("data", (data) => {
      console.log(`[STDERR] ${data.toString().trim()}`);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (!started) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

export async function healthCheck(url, retries = HEALTH_CHECK.retries) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, HEALTH_CHECK.interval)
      );
    }
  }
  return false;
}

export function getHealthCheckUrl(environment, packageName, port = null) {
  const targetPort = port || PORTS[environment][packageName];

  if (packageName === "server") {
    return `http://localhost:${targetPort}/health`;
  }
  return `http://localhost:${targetPort}`;
}

/**
 * Checks if deployment uses CDN mode based on metadata
 */
export function isCdnMode(metadata) {
  return metadata.assetPrefix && metadata.cdnAssets;
}

/**
 * Performs HEAD requests to verify CDN assets are accessible
 * Samples a subset of assets to avoid excessive requests
 */
export async function checkCdnAssets(metadata, logger) {
  if (!CDN_HEALTH_CHECK.enabled || !isCdnMode(metadata)) {
    return true;
  }

  const { assetPrefix, cdnAssets } = metadata;

  // Collect all asset paths from all directories
  const allAssets = [];
  for (const [directory, files] of Object.entries(cdnAssets)) {
    for (const file of files) {
      // Files are uploaded as-is from .next/static folder
      // packages/client/.next/static/chunks/app-123.js -> /_next/static/chunks/app-123.js
      const relativePath = directory.replace(
        /^packages\/[^/]+\/\.next/,
        "/_next"
      );
      const assetUrl = `${assetPrefix}${relativePath}/${file}`;
      allAssets.push({ file, url: assetUrl, directory });
    }
  }

  if (allAssets.length === 0) {
    logger.debug("No CDN assets to check");
    return true;
  }

  // Sample random assets to check
  const sampleSize = Math.min(CDN_HEALTH_CHECK.sampleSize, allAssets.length);
  const sampledAssets = [];
  const usedIndices = new Set();

  while (sampledAssets.length < sampleSize) {
    const randomIndex = Math.floor(Math.random() * allAssets.length);
    if (!usedIndices.has(randomIndex)) {
      usedIndices.add(randomIndex);
      sampledAssets.push(allAssets[randomIndex]);
    }
  }

  logger.debug(
    `Checking ${sampleSize} CDN assets out of ${allAssets.length} total`
  );

  const results = await Promise.allSettled(
    sampledAssets.map((asset) => checkCdnAsset(asset, logger))
  );

  const failed = results.filter((result) => result.status === "rejected");

  if (failed.length > 0) {
    logger.error(`${failed.length}/${sampleSize} CDN asset checks failed`);
    failed.forEach((result, index) => {
      const asset = sampledAssets[index];
      logger.error(`Failed: ${asset.file} - ${result.reason.message}`);
    });
    return false;
  }

  logger.debug(`All ${sampleSize} CDN asset checks passed`);
  return true;
}

/**
 * Performs HEAD request to verify a single CDN asset
 */
async function checkCdnAsset(asset, logger) {
  const { file, url } = asset;

  for (let attempt = 1; attempt <= CDN_HEALTH_CHECK.retries; attempt++) {
    try {
      logger.debug(`Checking CDN asset: ${file} (attempt ${attempt})`);

      const response = await fetch(url, {
        method: "HEAD",
        timeout: CDN_HEALTH_CHECK.timeout,
      });

      if (response.ok) {
        logger.debug(`✓ CDN asset accessible: ${file}`);
        return true;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      const isLastAttempt = attempt === CDN_HEALTH_CHECK.retries;

      if (isLastAttempt) {
        throw new Error(
          `CDN asset not accessible: ${file} at ${url} - ${error.message}`
        );
      }

      logger.debug(
        `Retry ${attempt}/${CDN_HEALTH_CHECK.retries} for ${file}: ${error.message}`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, CDN_HEALTH_CHECK.interval)
      );
    }
  }
}

/**
 * Gets the public URL for health checking based on environment and package
 */
export function getPublicHealthCheckUrl(environment, packageName) {
  const baseUrl = PUBLIC_URLS[environment];

  if (!baseUrl) {
    throw new Error(
      `Public URL not configured for environment: ${environment}`
    );
  }

  if (packageName === "server") {
    return `${baseUrl}/api/health`;
  }

  return baseUrl;
}

/**
 * Performs health check on the public-facing URL
 */
export async function publicHealthCheck(environment, packageName, logger) {
  if (!PUBLIC_HEALTH_CHECK.enabled) {
    logger.debug("Public health check disabled");
    return true;
  }

  const baseUrl = PUBLIC_URLS[environment];
  if (!baseUrl) {
    logger.warn(
      `Public URL not configured for environment: ${environment}, skipping public health check`
    );
    return true;
  }

  const url = getPublicHealthCheckUrl(environment, packageName);

  logger.debug(`Starting public health check for ${url}`);

  for (let attempt = 1; attempt <= PUBLIC_HEALTH_CHECK.retries; attempt++) {
    try {
      logger.debug(
        `Public health check attempt ${attempt}/${PUBLIC_HEALTH_CHECK.retries}: ${url}`
      );

      const response = await fetch(url, {
        timeout: PUBLIC_HEALTH_CHECK.timeout,
      });

      if (response.ok) {
        logger.debug(`✓ Public health check passed: ${url}`);
        return true;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      const isLastAttempt = attempt === PUBLIC_HEALTH_CHECK.retries;

      if (isLastAttempt) {
        logger.error(`✗ Public health check failed: ${url} - ${error.message}`);
        return false;
      }

      logger.debug(
        `Public health check retry ${attempt}/${PUBLIC_HEALTH_CHECK.retries}: ${error.message}`
      );

      if (attempt < PUBLIC_HEALTH_CHECK.retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, PUBLIC_HEALTH_CHECK.interval)
        );
      }
    }
  }

  return false;
}
