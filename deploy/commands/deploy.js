import fs from "fs-extra";
import { join } from "path";
import { Logger } from "../utils/logger.js";
import { getDeploymentPaths, getReleasePath } from "../utils/paths.js";
import {
  extractArtifact,
  readMetadata,
  updateSymlink,
  createTempDir,
  execCommand,
} from "../utils/fileOps.js";
import {
  findAvailablePort,
  startTestServer,
  healthCheck,
  getHealthCheckUrl,
  isCdnMode,
  checkCdnAssets,
} from "../utils/healthCheck.js";
import { updateVersionTracking } from "../utils/versions.js";
import {
  cleanupDeployments,
  cleanupFailedDeployment,
} from "../utils/cleanup.js";
import { copyEnvironmentFile } from "../utils/envFiles.js";

export async function deploy(options) {
  const logger = new Logger(options.verbose);
  let releasePath = null;

  try {
    logger.info("Starting deployment process");

    // Step 1: Validate artifact and extract metadata
    logger.step("Validating artifact and extracting metadata");
    const metadata = await readMetadata(options.artifact);
    logger.debug(`Metadata: ${JSON.stringify(metadata, null, 2)}`);

    const {
      environment,
      package: packageName,
      commit,
      timestamp: buildTimestamp,
    } = metadata;

    // Log CDN mode information
    if (isCdnMode(metadata)) {
      const assetCount = Object.values(metadata.cdnAssets).flat().length;
      logger.info(
        `CDN Mode: ${assetCount} assets served from ${metadata.assetPrefix}`
      );
    }

    if (options.dryRun) {
      logger.info(
        `Dry run completed successfully for ${packageName} -> ${environment}`
      );
      return;
    }

    // Step 2: Prepare release directory
    const deploymentTimestamp =
      new Date().toISOString().replace(/[:.]/g, "-").split("T")[0] +
      "-" +
      new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .split("T")[1]
        .split("-")[0];
    releasePath = getReleasePath(
      environment,
      packageName,
      commit,
      deploymentTimestamp
    );
    const paths = getDeploymentPaths(environment, packageName);

    logger.step(`Preparing release directory: ${releasePath}`);
    await fs.ensureDir(releasePath);

    // Step 3: Extract artifact to release directory
    logger.step("Extracting artifact to release directory");
    await extractArtifact(options.artifact, releasePath);

    // Step 4: Copy environment file
    logger.step("Copying environment file");
    await copyEnvironmentFile(releasePath, packageName, environment, logger);

    // Step 5: Install production dependencies
    logger.step("Installing production dependencies");
    await execCommand(
      `cd "${releasePath}" && pnpm install --prod --frozen-lockfile`
    );

    // Step 6: Isolated health check
    logger.step("Running isolated health check");
    await runHealthCheck(releasePath, packageName, environment, logger);

    // Step 7: Atomic deployment
    logger.step("Performing atomic deployment");
    await updateSymlink(releasePath, paths.current);

    // Step 8: Start or reload PM2 service
    logger.step("Starting/reloading PM2 service");
    const serviceName = `tobeit69-${packageName}-${environment}`;

    try {
      // Try to reload first (if service exists)
      await execCommand(`pm2 reload "${serviceName}"`);
      logger.debug(`Reloaded existing PM2 service: ${serviceName}`);
    } catch (error) {
      // Service doesn't exist, start it with PM2 config
      logger.debug(`Service ${serviceName} not found, starting new instance`);
      await execCommand(
        `pm2 start "${paths.pm2Config}" --only "${serviceName}"`
      );
      logger.debug(`Started new PM2 service: ${serviceName}`);
    }

    // Verify PM2 service is healthy
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait for PM2 to start/reload
    const { stdout } = await execCommand(`pm2 describe "${serviceName}"`);
    if (!stdout.includes("online")) {
      throw new Error(`PM2 service ${serviceName} failed to start`);
    }

    // Step 9: Final health check on production ports
    logger.step("Running final health check on production ports");
    const prodUrl = getHealthCheckUrl(environment, packageName);
    const isHealthy = await healthCheck(prodUrl);

    if (!isHealthy) {
      throw new Error(`Health check failed for ${prodUrl}`);
    }

    // Step 10: CDN asset health check (if in CDN mode)
    if (isCdnMode(metadata)) {
      logger.step("Verifying CDN asset accessibility");
      const cdnHealthy = await checkCdnAssets(metadata, logger);

      if (!cdnHealthy) {
        throw new Error("CDN asset health check failed");
      }
    }

    // Step 11: Update version tracking
    logger.step("Updating version tracking");
    const versionInfo = `${deploymentTimestamp}-${commit.substring(0, 7)}`;
    await updateVersionTracking(environment, packageName, {
      version: versionInfo,
      commit,
      timestamp: new Date().toISOString(),
      releasePath,
    });

    // Step 12: Cleanup old deployments
    await cleanupDeployments(environment, packageName, logger);

    logger.success(`✨ Deployment completed successfully!`);
    logger.info(`Package: ${packageName}`);
    logger.info(`Environment: ${environment}`);
    logger.info(`Commit: ${commit}`);
    logger.info(`Version: ${versionInfo}`);
    logger.info(`Release: ${releasePath}`);

    // Return success result instead of exiting
    return {
      success: true,
      packageName,
      environment,
      commit,
      versionInfo,
      releasePath,
    };
  } catch (error) {
    logger.error(`Deployment failed: ${error.message}`);
    if (options.verbose) {
      logger.error(error.stack);
    }

    // Cleanup failed deployment
    if (releasePath) {
      await cleanupFailedDeployment(releasePath, logger);
    }

    // Re-throw error instead of exiting
    throw error;
  }
}

async function runHealthCheck(releasePath, packageName, environment, logger) {
  const packagePath = join(releasePath, "packages", packageName);

  if (!(await fs.pathExists(packagePath))) {
    throw new Error(`Package path not found: ${packagePath}`);
  }

  // Find available port for health check
  const testPort = await findAvailablePort();
  logger.debug(`Using port ${testPort} for health check`);

  let testServer;
  try {
    // Start test server
    testServer = await startTestServer(packagePath, testPort, {
      NODE_ENV: "production",
    });
    logger.debug("Test server started successfully");

    // Wait a moment for server to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Perform health check
    const healthUrl = getHealthCheckUrl(environment, packageName, testPort);
    const isHealthy = await healthCheck(healthUrl);

    if (!isHealthy) {
      throw new Error(`Health check failed for ${healthUrl}`);
    }

    logger.debug("Health check passed");
  } finally {
    if (testServer) {
      // Wait for the process to actually terminate
      const promise = new Promise((resolve) => {
        // Force kill if it doesn't exit within 10 seconds
        let forceTimeout = setTimeout(() => {
          if (!testServer.killed) {
            try {
              process.kill(-testServer.pid, "SIGKILL");
            } catch {}
            logger.debug("Test server force killed");
          }
          resolve();
        }, 10_000);
        testServer.on("exit", () => {
          logger.debug("Test server terminated");
          clearTimeout(forceTimeout);
          resolve();
        });
      });

      logger.debug("Sending signal to terminate test server...");

      // Properly terminate the test server and wait for it to exit
      // Kill entire process group to ensure npm and its children are terminated
      process.kill(-testServer.pid, "SIGTERM");

      await promise;
    }
  }
}
