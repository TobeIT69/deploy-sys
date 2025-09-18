import fs from "fs-extra";
import { join } from "path";
import { Logger } from "../utils/logger.js";
import { getDeploymentPaths, getReleasePath } from "../utils/paths.js";
import {
  extractArtifact,
  readMetadata,
  updateSymlink,
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
import {
  copyEnvironmentFile,
  manageCdnEnvironment,
} from "../utils/envFiles.js";
import {
  downloadArtifactFromRun,
  cleanupArtifactDownload,
} from "../utils/artifactDownloader.js";
import { updateDeploymentStatus } from "../utils/deploymentStatus.js";
import { createDeployment, isGitHubConfigured } from "../utils/githubClient.js";
import { formatEnvironment } from "../utils/parseEnvironment.js";
import { sendDiscordNotification } from "../utils/discordNotifications.js";

export async function deploy(options) {
  const logger = new Logger(options.verbose);
  let releasePath = null;
  let downloadTempDir = null;
  const triggerSource = options.triggerSource || "manual";

  try {
    logger.info("Starting deployment process");

    let artifactPath = options.artifact;
    let metadata;

    // Handle GitHub Actions run ID mode
    if (options.runId) {
      logger.step("Downloading artifact from GitHub Actions");

      // Update deployment status if deployment ID is provided
      if (options.deploymentId) {
        await updateDeploymentStatus(
          options.deploymentId,
          "in_progress",
          `Downloading artifact for ${options.package} deployment`
        );
      }

      const downloadResult = await downloadArtifactFromRun(
        options.runId,
        options.package
      );

      artifactPath = downloadResult.artifactPath;
      downloadTempDir = downloadResult.tempDir;

      logger.info(`📦 Downloaded artifact: ${artifactPath}`);
    }

    // Step 1: Validate artifact and extract metadata
    logger.step("Validating artifact and extracting metadata");
    metadata = await readMetadata(artifactPath);
    logger.debug(`Metadata: ${JSON.stringify(metadata, null, 2)}`);

    const { environment, package: packageName, commit } = metadata;

    // Send Discord notification for deployment start
    await sendDiscordNotification("deploying", {
      packageName,
      environment,
      commit,
      deploymentId: options.deploymentId,
      workflowRunId: options.runId,
      isLocalArtifact: !options.runId,
      triggerSource,
    });

    // Create GitHub deployment if not provided and GitHub is configured
    if (!options.deploymentId && isGitHubConfigured()) {
      try {
        logger.step("Creating GitHub deployment");

        const deploymentEnvironment = formatEnvironment(
          environment,
          packageName
        );
        const deployment = await createDeployment({
          environment: deploymentEnvironment,
          ref: commit,
          skipWebhook: true,
          workflowRunId: options.runId,
        });

        options.deploymentId = deployment.id;

        logger.info(
          `📋 Created GitHub deployment: ${deployment.id} for ${deploymentEnvironment}`
        );
      } catch (error) {
        logger.warn(`⚠️  Failed to create GitHub deployment: ${error.message}`);
        logger.info("Continuing with deployment without GitHub status updates");
      }
    }

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
    await extractArtifact(artifactPath, releasePath);

    // Step 4: Copy environment file
    logger.step("Copying environment file");
    await copyEnvironmentFile(releasePath, packageName, environment, logger);

    // Step 5: Manage CDN environment variables
    logger.step("Configuring CDN environment");
    const packagePath = join(releasePath, "packages", packageName);
    await manageCdnEnvironment(packagePath, metadata, logger);

    // Step 6: Install production dependencies
    logger.step("Installing production dependencies");
    await execCommand(
      `cd "${releasePath}" && pnpm install --prod --frozen-lockfile`
    );

    // Step 7: Isolated health check
    logger.step("Running isolated health check");
    await runHealthCheck(releasePath, packageName, environment, logger);

    // Step 8: Atomic deployment
    logger.step("Performing atomic deployment");

    // Update deployment status if deployment ID is provided
    if (options.deploymentId) {
      await updateDeploymentStatus(
        options.deploymentId,
        "in_progress",
        `Deploying ${packageName} to ${environment}`
      );
    }

    // Send Discord notification for deployment in progress
    await sendDiscordNotification("in_progress", {
      packageName,
      environment,
      commit,
      deploymentId: options.deploymentId,
      workflowRunId: options.runId,
      isLocalArtifact: !options.runId,
      triggerSource,
    });

    await updateSymlink(releasePath, paths.current);

    // Step 9: Start or reload PM2 service
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

    // Step 10: Final health check on production ports
    logger.step("Running final health check on production ports");
    const prodUrl = getHealthCheckUrl(environment, packageName);
    const isHealthy = await healthCheck(prodUrl);

    if (!isHealthy) {
      throw new Error(`Health check failed for ${prodUrl}`);
    }

    // Step 11: CDN asset health check (if in CDN mode)
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

    // Update deployment status to success if deployment ID is provided
    if (options.deploymentId) {
      await updateDeploymentStatus(
        options.deploymentId,
        "success",
        `Successfully deployed ${packageName} to ${environment}`
      );
    }

    // Send Discord notification for successful deployment
    await sendDiscordNotification("success", {
      packageName,
      environment,
      commit,
      deploymentId: options.deploymentId,
      versionInfo,
      workflowRunId: options.runId,
      isLocalArtifact: !options.runId,
      triggerSource,
    });

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

    // Update deployment status to failure if deployment ID is provided
    if (options.deploymentId) {
      await updateDeploymentStatus(
        options.deploymentId,
        "failure",
        `Deployment failed: ${error.message}`
      );
    }

    // Send Discord notification for failed deployment
    // Extract metadata if available for better error context
    let errorPackageName, errorEnvironment, errorCommit;
    try {
      if (metadata) {
        ({ environment: errorEnvironment, package: errorPackageName, commit: errorCommit } = metadata);
      }
    } catch (metadataError) {
      // Ignore metadata extraction errors in error handler
    }

    await sendDiscordNotification("failure", {
      packageName: errorPackageName,
      environment: errorEnvironment,
      commit: errorCommit,
      deploymentId: options.deploymentId,
      error: error.message,
      workflowRunId: options.runId,
      isLocalArtifact: !options.runId,
      triggerSource,
    });

    // Cleanup failed deployment
    if (releasePath) {
      await cleanupFailedDeployment(releasePath, logger);
    }

    // Re-throw error instead of exiting
    throw error;
  } finally {
    // Cleanup downloaded artifact if it was downloaded
    if (downloadTempDir) {
      try {
        await cleanupArtifactDownload(downloadTempDir);
        logger.debug(`🧹 Cleaned up downloaded artifact: ${downloadTempDir}`);
      } catch (cleanupError) {
        logger.warn(
          `Failed to cleanup downloaded artifact: ${cleanupError.message}`
        );
      }
    }
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
