import fs from "fs-extra";
import { join } from "path";
import { PATHS } from "../config.js";

/**
 * Copy environment file for a specific package and environment
 * @param {string} releasePath - Path to the release directory
 * @param {string} packageName - Package name (client/server)
 * @param {string} environment - Environment (main/staging/prod)
 * @param {Object} logger - Logger instance
 */
export async function copyEnvironmentFile(
  releasePath,
  packageName,
  environment,
  logger
) {
  const sourceEnvFile = join(PATHS.dotenv, packageName, `.env.${environment}`);
  const targetEnvFile = join(
    releasePath,
    "packages",
    packageName,
    ".env.local"
  );

  logger.debug(
    `Copying environment file from ${sourceEnvFile} to ${targetEnvFile}`
  );

  // Check if source environment file exists
  if (!(await fs.pathExists(sourceEnvFile))) {
    throw new Error(`Environment file not found: ${sourceEnvFile}`);
  }

  // Ensure target directory exists
  await fs.ensureDir(join(releasePath, "packages", packageName));

  // Copy the environment file
  await fs.copy(sourceEnvFile, targetEnvFile);

  logger.debug(`Environment file copied successfully`);
}
