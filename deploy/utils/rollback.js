import fs from "fs-extra";
import { join } from "path";
import { getVersionHistory } from "./versions.js";

export async function findRollbackTarget(
  environment,
  packageName,
  options = {}
) {
  const versionHistory = await getVersionHistory(environment, packageName);

  if (!versionHistory.deployments || versionHistory.deployments.length === 0) {
    throw new Error(
      `No deployment history found for ${packageName} in ${environment}`
    );
  }

  // If no specific commit requested, find the most recent inactive deployment
  if (!options.commit) {
    return findPreviousDeployment(versionHistory);
  }

  // Find deployments for the specific commit (support both full and partial commit hashes)
  const commitDeployments = versionHistory.deployments.filter(
    (deployment) =>
      deployment.commit === options.commit ||
      deployment.commit.startsWith(options.commit)
  );

  if (commitDeployments.length === 0) {
    throw new Error(`No deployments found for commit: ${options.commit}`);
  }

  // If specific attempt requested, find exact match
  if (options.attempt) {
    return findSpecificAttempt(commitDeployments, options.attempt);
  }

  // Otherwise return the most recent deployment for this commit
  return commitDeployments.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )[0];
}

function findPreviousDeployment(versionHistory) {
  // Find the most recent deployment that is not currently active
  const inactiveDeployments = versionHistory.deployments.filter(
    (deployment) => deployment.status !== "active"
  );

  if (inactiveDeployments.length === 0) {
    throw new Error("No previous deployments available for rollback");
  }

  // Sort by timestamp, newest first
  const sortedDeployments = inactiveDeployments.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return sortedDeployments[0];
}

function findSpecificAttempt(commitDeployments, attemptTimestamp) {
  // Look for deployment matching the attempt timestamp pattern
  const matchingDeployment = commitDeployments.find((deployment) => {
    // Extract timestamp from release path (e.g., "releases/abc1234/2025-09-13-14-30")
    const pathParts = deployment.releasePath.split("/");
    const releaseTimestamp = pathParts[pathParts.length - 1];
    return releaseTimestamp === attemptTimestamp;
  });

  if (!matchingDeployment) {
    throw new Error(
      `No deployment attempt found for timestamp: ${attemptTimestamp}`
    );
  }

  return matchingDeployment;
}

export async function validateRollbackTarget(rollbackTarget) {
  if (!rollbackTarget.releasePath) {
    throw new Error("Rollback target missing release path");
  }

  // Check if the target deployment directory still exists
  const targetExists = await fs.pathExists(rollbackTarget.releasePath);
  if (!targetExists) {
    throw new Error(
      `Rollback target directory not found: ${rollbackTarget.releasePath}`
    );
  }

  // Verify the deployment directory has the expected structure
  const packagePath = join(rollbackTarget.releasePath, "packages");
  const packageExists = await fs.pathExists(packagePath);
  if (!packageExists) {
    throw new Error(
      `Invalid rollback target: missing packages directory in ${rollbackTarget.releasePath}`
    );
  }

  return true;
}

export function getRollbackCandidates(versionHistory, limit = 5) {
  if (!versionHistory.deployments || versionHistory.deployments.length === 0) {
    return [];
  }

  // Get all deployments except the current active one
  const candidates = versionHistory.deployments
    .filter((deployment) => deployment.status !== "active")
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, limit);

  return candidates.map((deployment) => ({
    version: deployment.version,
    commit: deployment.commit.substring(0, 7),
    timestamp: deployment.timestamp,
    releasePath: deployment.releasePath,
    age: getRelativeTime(deployment.timestamp),
  }));
}

function getRelativeTime(timestamp) {
  const now = new Date();
  const deployTime = new Date(timestamp);
  const diffMs = now.getTime() - deployTime.getTime();

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return "Just now";
}
