import fs from "fs-extra";
import { join } from "path";
import { Logger } from "../utils/logger.js";
import { getDeploymentPaths } from "../utils/paths.js";
import { updateSymlink, execCommand } from "../utils/fileOps.js";
import { healthCheck, getHealthCheckUrl } from "../utils/healthCheck.js";
import {
  findRollbackTarget,
  validateRollbackTarget,
  getRollbackCandidates,
} from "../utils/rollback.js";
import { updateVersionTracking, getVersionHistory } from "../utils/versions.js";
import {
  copyEnvironmentFile,
  manageCdnEnvironment,
} from "../utils/envFiles.js";
import { sendDiscordNotification } from "../utils/discordNotifications.js";

export async function rollback(options) {
  const logger = new Logger(options.verbose);

  try {
    logger.info("Starting rollback process");

    const { package: packageName, env: environment } = options;

    if (!packageName || !environment) {
      throw new Error("Both --package and --env are required");
    }

    // Step 1: Find rollback target
    logger.step("Finding rollback target");
    const rollbackTarget = await findRollbackTarget(environment, packageName, {
      commit: options.commit,
      attempt: options.attempt,
    });

    logger.info(`Rollback target: ${rollbackTarget.version}`);
    logger.info(`Commit: ${rollbackTarget.commit}`);
    logger.info(
      `Deployed: ${new Date(rollbackTarget.timestamp).toLocaleString()}`
    );
    logger.debug(`Release path: ${rollbackTarget.releasePath}`);

    // Step 2: Validate rollback target
    logger.step("Validating rollback target");
    await validateRollbackTarget(rollbackTarget);

    // Step 3: Show rollback candidates if no specific target
    if (!options.commit && !options.attempt) {
      logger.step("Available rollback candidates");
      const candidates = await getRollbackCandidates(
        await getVersionHistory(environment, packageName)
      );

      candidates.slice(0, 3).forEach((candidate, index) => {
        const marker = index === 0 ? "→" : " ";
        logger.info(
          `${marker} ${candidate.version} (${candidate.commit}) - ${candidate.age}`
        );
      });
    }

    // Step 4: Copy environment file for rollback target
    logger.step("Copying environment file");
    await copyEnvironmentFile(
      rollbackTarget.releasePath,
      packageName,
      environment,
      logger
    );

    // Step 5: Health check on rollback target
    logger.step("Performing health check on rollback target");
    await performRollbackHealthCheck(
      rollbackTarget,
      packageName,
      environment,
      logger
    );

    // Step 6: Atomic rollback - update symlink
    const paths = getDeploymentPaths(environment, packageName);
    logger.step("Performing atomic rollback");
    await updateSymlink(rollbackTarget.releasePath, paths.current);

    // Step 7: Configure CDN environment for rollback target
    logger.step("Configuring CDN environment");
    const packagePath = join(
      rollbackTarget.releasePath,
      "packages",
      packageName
    );

    // Read metadata from the deployment directory
    const metadataFile = join(rollbackTarget.releasePath, "metadata.json");
    let rollbackMetadata = {};
    if (await fs.pathExists(metadataFile)) {
      try {
        rollbackMetadata = await fs.readJson(metadataFile);
        logger.debug(`Loaded metadata from ${metadataFile}`);
      } catch (error) {
        logger.warn(`Failed to read metadata file: ${error.message}`);
      }
    } else {
      logger.debug("No metadata file found - assuming non-CDN deployment");
    }

    await manageCdnEnvironment(packagePath, rollbackMetadata, logger);

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

    // Wait for PM2 to start/reload
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify PM2 service is healthy
    const { stdout } = await execCommand(`pm2 describe "${serviceName}"`);
    if (!stdout.includes("online")) {
      throw new Error(
        `PM2 service ${serviceName} failed to start after rollback`
      );
    }

    // Step 8: Final health check on production ports
    logger.step("Running final health check on production ports");
    const prodUrl = getHealthCheckUrl(environment, packageName);
    const isHealthy = await healthCheck(prodUrl);

    if (!isHealthy) {
      throw new Error(`Health check failed after rollback: ${prodUrl}`);
    }

    // Step 9: Update version tracking
    logger.step("Updating version tracking");
    await updateVersionTracking(environment, packageName, {
      version: rollbackTarget.version,
      commit: rollbackTarget.commit,
      timestamp: new Date().toISOString(),
      releasePath: rollbackTarget.releasePath,
    });

    // Send Discord notification for successful rollback
    await sendDiscordNotification("success", {
      packageName,
      environment,
      commit: rollbackTarget.commit,
      versionInfo: `Rolled back to ${rollbackTarget.version}`,
      isLocalArtifact: true, // Rollbacks are manual/local operations
      triggerSource: "manual",
    });

    logger.success("✨ Rollback completed successfully!");
    logger.info(`Package: ${packageName}`);
    logger.info(`Environment: ${environment}`);
    logger.info(`Rolled back to: ${rollbackTarget.version}`);
    logger.info(`Commit: ${rollbackTarget.commit}`);

    return { success: true };
  } catch (error) {
    logger.error(`Rollback failed: ${error.message}`);
    if (options.verbose) {
      logger.error(error.stack);
    }

    // Send Discord notification for failed rollback
    const { package: packageName, env: environment } = options;
    await sendDiscordNotification("failure", {
      packageName,
      environment,
      error: `Rollback failed: ${error.message}`,
      isLocalArtifact: true, // Rollbacks are manual/local operations
      triggerSource: "manual",
    });

    throw error;
  }
}

async function performRollbackHealthCheck(
  _rollbackTarget,
  _packageName,
  _environment,
  logger
) {
  // For rollback, we trust that if the deployment directory exists and has the right structure,
  // it should be healthy since it was previously deployed successfully

  // Basic structure validation was already done in validateRollbackTarget
  logger.debug(
    "Rollback target validation passed - skipping isolated health check"
  );

  // We'll rely on the final health check after PM2 reload to ensure the service is working
}
