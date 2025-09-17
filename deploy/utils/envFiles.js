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

/**
 * Manage CDN environment variables for a package deployment
 * @param {string} packagePath - Path to the package directory
 * @param {Object} metadata - Deployment metadata containing assetPrefix
 * @param {Object} logger - Logger instance
 */
export async function manageCdnEnvironment(packagePath, metadata, logger) {
  const cdnEnvFile = join(packagePath, ".env.cdn");

  if (metadata.assetPrefix && metadata.cdnAssets) {
    // CDN mode: create .env.cdn file
    const cdnContent = `NEXT_PUBLIC_CDN_ASSETS_URL=${metadata.assetPrefix}\n`;
    await fs.writeFile(cdnEnvFile, cdnContent);
    logger.debug(
      `Created CDN environment file with assetPrefix: ${metadata.assetPrefix}`
    );
  } else {
    // Non-CDN mode: remove .env.cdn file if it exists
    if (await fs.pathExists(cdnEnvFile)) {
      await fs.remove(cdnEnvFile);
      logger.debug("Removed CDN environment file (non-CDN mode)");
    }
  }
}
