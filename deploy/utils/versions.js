import fs from "fs-extra";
import { join } from "path";
import { getVersionFile } from "./paths.js";

export async function updateVersionTracking(
  environment,
  packageName,
  deployment
) {
  const versionFile = getVersionFile(environment, packageName);

  // Ensure versions directory exists
  await fs.ensureDir(join(versionFile, ".."));

  let versionData = {
    current: null,
    deployments: [],
  };

  // Read existing version data if it exists
  if (await fs.pathExists(versionFile)) {
    try {
      versionData = await fs.readJson(versionFile);
    } catch (error) {
      // If file is corrupted, start fresh
      versionData = { current: null, deployments: [] };
    }
  }

  // Create new deployment record
  const newDeployment = {
    version: deployment.version,
    commit: deployment.commit,
    timestamp: deployment.timestamp,
    packages: [packageName],
    status: "active",
    releasePath: deployment.releasePath,
  };

  // Mark previous deployment as inactive
  versionData.deployments.forEach((dep) => {
    if (dep.status === "active" && dep.packages.includes(packageName)) {
      dep.status = "inactive";
    }
  });

  // Add new deployment
  versionData.deployments.unshift(newDeployment);
  versionData.current = deployment.version;

  // Save updated version data
  await fs.writeJson(versionFile, versionData, { spaces: 2 });

  return versionData;
}

export async function getVersionHistory(environment, packageName) {
  const versionFile = getVersionFile(environment, packageName);

  if (!(await fs.pathExists(versionFile))) {
    return { current: null, deployments: [] };
  }

  try {
    return await fs.readJson(versionFile);
  } catch (error) {
    return { current: null, deployments: [] };
  }
}
