import fs from "fs-extra";
import { Logger } from "../utils/logger.js";
import { getVersionHistory } from "../utils/versions.js";

export async function list(options) {
  const logger = new Logger(options.verbose);
  const {
    package: packageName,
    env: environment,
    limit: limitStr = "10",
  } = options;
  const limit = parseInt(limitStr, 10);

  try {
    logger.info(`Listing deployments for ${packageName}/${environment}`);

    // Get version history
    const versionData = await getVersionHistory(environment, packageName);

    if (!versionData.deployments || versionData.deployments.length === 0) {
      logger.error(`No deployments found for ${packageName}/${environment}`);
      return;
    }

    console.log(`\nDeployment History (${packageName}/${environment}):\n`);

    // Apply limit to deployments
    const deploymentsToShow = versionData.deployments.slice(0, limit);

    for (const deployment of deploymentsToShow) {
      const isActive = deployment.status === "active";
      const statusIcon = isActive ? "✅" : "  ";
      const statusLabel = isActive ? "[ACTIVE]" : "[INACTIVE]";

      // Format deployment info
      const shortCommit = deployment.commit.substring(0, 7);
      const deployedDate = new Date(deployment.timestamp);
      const formattedDate = deployedDate.toLocaleDateString();
      const formattedTime = deployedDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      // Main deployment line
      console.log(`${statusIcon} ${deployment.version} ${statusLabel}`);

      if (options.verbose) {
        console.log(`   Commit: ${shortCommit} (${deployment.commit})`);
      } else {
        console.log(`   Commit: ${shortCommit} (${deployment.commit})`);
      }

      console.log(`   Deployed: ${formattedDate} ${formattedTime}`);
      console.log(`   Status: ${deployment.status}`);

      // Verbose information
      if (options.verbose) {
        console.log(
          `   Release Path: ${deployment.releasePath.replace(
            process.env.HOME,
            "~"
          )}`
        );

        // Check if deployment directory exists
        try {
          const deploymentExists = await fs.pathExists(deployment.releasePath);
          console.log(
            `   Directory Exists: ${deploymentExists ? "✅ Yes" : "❌ No"}`
          );

          if (deploymentExists) {
            const packageJsonPath = `${deployment.releasePath}/packages/${packageName}/package.json`;
            const packageJsonExists = await fs.pathExists(packageJsonPath);

            if (packageJsonExists) {
              try {
                const packageJson = await fs.readJson(packageJsonPath);
                console.log(
                  `   Package Version: ${packageJson.version || "Unknown"}`
                );

                // Get directory size
                const stats = await fs.stat(deployment.releasePath);
                console.log(
                  `   Last Modified: ${stats.mtime.toLocaleDateString()}`
                );
              } catch (error) {
                logger.debug(
                  `Error reading package.json for ${deployment.version}: ${error.message}`
                );
              }
            } else {
              console.log(`   Package.json: ❌ Missing`);
            }
          }
        } catch (error) {
          logger.debug(
            `Error checking deployment directory for ${deployment.version}: ${error.message}`
          );
        }
      }

      console.log(); // Empty line between deployments
    }

    // Summary
    const totalDeployments = versionData.deployments.length;
    const activeDeployments = versionData.deployments.filter(
      (d) => d.status === "active"
    ).length;
    const inactiveDeployments = totalDeployments - activeDeployments;

    console.log(
      `Total: ${totalDeployments} deployments found (${activeDeployments} active, ${inactiveDeployments} inactive)`
    );

    if (totalDeployments > limit) {
      console.log(
        `Showing first ${limit} deployments. Use --limit to show more.`
      );
    }

    // Additional verbose summary
    if (options.verbose && totalDeployments > 0) {
      console.log(`\nSummary:`);
      console.log(`  Current Active: ${versionData.current || "None"}`);
      console.log(
        `  Oldest Deployment: ${
          versionData.deployments[totalDeployments - 1]?.timestamp
            ? new Date(
                versionData.deployments[totalDeployments - 1].timestamp
              ).toLocaleDateString()
            : "Unknown"
        }`
      );
      console.log(
        `  Newest Deployment: ${
          versionData.deployments[0]?.timestamp
            ? new Date(
                versionData.deployments[0].timestamp
              ).toLocaleDateString()
            : "Unknown"
        }`
      );

      // Show unique commits
      const uniqueCommits = [
        ...new Set(
          versionData.deployments.map((d) => d.commit.substring(0, 7))
        ),
      ];
      console.log(
        `  Unique Commits: ${uniqueCommits.length} (${uniqueCommits
          .slice(0, 5)
          .join(", ")}${uniqueCommits.length > 5 ? "..." : ""})`
      );
    }
  } catch (error) {
    logger.error(`Failed to list deployments: ${error.message}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
