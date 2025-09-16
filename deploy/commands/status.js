import fs from "fs-extra";
import { Logger } from "../utils/logger.js";
import { getVersionHistory } from "../utils/versions.js";
import { getHealthCheckUrl, healthCheck } from "../utils/healthCheck.js";
import { execCommand } from "../utils/fileOps.js";
import { PORTS } from "../config.js";

export async function status(options) {
  const logger = new Logger(options.verbose);
  const { package: packageName, env: environment } = options;

  try {
    logger.info(`Getting deployment status for ${packageName}/${environment}`);

    // Get version history
    const versionData = await getVersionHistory(environment, packageName);

    if (!versionData.current) {
      logger.error(`No deployments found for ${packageName}/${environment}`);
      return;
    }

    // Find current active deployment
    const currentDeployment = versionData.deployments.find(
      (dep) => dep.status === "active" && dep.packages.includes(packageName)
    );

    if (!currentDeployment) {
      logger.error(
        `No active deployment found for ${packageName}/${environment}`
      );
      return;
    }

    // Get PM2 service status
    const serviceName = `tobeit69-${packageName}-${environment}`;
    let pm2Status = "unknown";
    let pm2Info = null;

    try {
      const { stdout } = await execCommand(`pm2 jlist`);
      const pm2List = JSON.parse(stdout);

      // Find our specific service
      pm2Info = pm2List.find((service) => service.name === serviceName);

      if (pm2Info) {
        pm2Status = pm2Info.pm2_env.status || "unknown";
      } else {
        pm2Status = "not found";
      }
    } catch (error) {
      pm2Status = "not found";
      logger.debug(`Failed to get PM2 status: ${error.message}`);
    }

    // Perform health check
    const port = PORTS[environment][packageName];
    const healthUrl = getHealthCheckUrl(environment, packageName);
    let healthStatus = "❌ Unhealthy";

    try {
      const isHealthy = await healthCheck(healthUrl, 1); // Single retry for status check
      healthStatus = isHealthy ? "✅ Healthy" : "❌ Unhealthy";
    } catch (error) {
      healthStatus = "❌ Unhealthy";
      logger.debug(`Health check failed: ${error.message}`);
    }

    // Display status information
    logger.success("Current Active Deployment:");
    console.log(`  Package: ${packageName}`);
    console.log(`  Environment: ${environment}`);
    console.log(`  Version: ${currentDeployment.version}`);

    if (options.verbose) {
      console.log(`  Commit: ${currentDeployment.commit}`);
    } else {
      console.log(
        `  Commit: ${currentDeployment.commit.substring(0, 7)} (${
          currentDeployment.commit
        })`
      );
    }

    console.log(
      `  Deployed: ${new Date(currentDeployment.timestamp).toLocaleString()}`
    );

    if (options.verbose) {
      console.log(`  Release Path: ${currentDeployment.releasePath}`);
    } else {
      console.log(
        `  Release Path: ${currentDeployment.releasePath.replace(
          process.env.HOME,
          "~"
        )}`
      );
    }

    console.log(`  PM2 Status: ${pm2Status}`);
    console.log(`  Health: ${healthStatus} (${healthUrl})`);

    // Verbose information
    if (options.verbose && pm2Info) {
      console.log("\nDetailed PM2 Information:");
      console.log(`  PID: ${pm2Info.pid || "N/A"}`);
      console.log(
        `  Uptime: ${
          pm2Info.pm2_env.pm_uptime
            ? new Date(pm2Info.pm2_env.pm_uptime).toLocaleString()
            : "N/A"
        }`
      );
      console.log(`  Restarts: ${pm2Info.pm2_env.restart_time || 0}`);
      console.log(
        `  Memory Usage: ${
          pm2Info.monit?.memory
            ? `${Math.round(pm2Info.monit.memory / 1024 / 1024)}MB`
            : "N/A"
        }`
      );
      console.log(
        `  CPU Usage: ${
          pm2Info.monit?.cpu !== undefined ? `${pm2Info.monit.cpu}%` : "N/A"
        }`
      );
      console.log(
        `  Node.js Version: ${pm2Info.pm2_env.node_version || "N/A"}`
      );
      console.log(`  Working Directory: ${pm2Info.pm2_env.pm_cwd || "N/A"}`);
    }

    // Check if deployment directory exists
    if (options.verbose) {
      const deploymentExists = await fs.pathExists(
        currentDeployment.releasePath
      );
      console.log(`\nDeployment Directory:`);
      console.log(`  Exists: ${deploymentExists ? "✅ Yes" : "❌ No"}`);

      if (deploymentExists) {
        try {
          const packageJsonPath = `${currentDeployment.releasePath}/packages/${packageName}/package.json`;
          const packageJsonExists = await fs.pathExists(packageJsonPath);
          console.log(
            `  Package.json: ${packageJsonExists ? "✅ Present" : "❌ Missing"}`
          );

          if (packageJsonExists) {
            const packageJson = await fs.readJson(packageJsonPath);
            console.log(`  Package Name: ${packageJson.name || "Unknown"}`);
            console.log(
              `  Package Version: ${packageJson.version || "Unknown"}`
            );
          }
        } catch (error) {
          logger.debug(`Error reading package.json: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to get deployment status: ${error.message}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    throw error;
  }
}
