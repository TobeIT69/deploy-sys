import { join } from "path";
import { PATHS } from "../config.js";

export function getDeploymentPaths(environment, packageName) {
  const envPath = join(PATHS.deployments, environment, packageName);

  return {
    envPath,
    current: join(envPath, "current"),
    releases: join(envPath, "releases"),
    pm2Config: join(PATHS.deployments, environment, "ecosystem.config.js"),
  };
}

export function getReleasePath(environment, packageName, commit, timestamp) {
  const { releases } = getDeploymentPaths(environment, packageName);
  // Use short commit hash (first 7 characters) for directory structure
  const shortCommit = commit.substring(0, 7);
  return join(releases, shortCommit, timestamp);
}

export function getVersionFile(environment, packageName) {
  return join(PATHS.versions, `${environment}-${packageName}.json`);
}
