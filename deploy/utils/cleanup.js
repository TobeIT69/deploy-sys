import fs from "fs-extra";
import { join } from "path";
import { getDeploymentPaths } from "./paths.js";
import { getVersionHistory } from "./versions.js";
import { CLEANUP } from "../config.js";

export async function cleanupDeployments(environment, packageName, logger) {
  const paths = getDeploymentPaths(environment, packageName);

  if (!(await fs.pathExists(paths.releases))) {
    logger.debug("No releases directory found, skipping cleanup");
    return;
  }

  logger.step("Cleaning up old deployments");

  // Get version history to determine what to keep
  const versionHistory = await getVersionHistory(environment, packageName);

  // Step 1: Commit-based cleanup (keep 5 recent commits based on version history)
  await cleanupCommits(paths.releases, versionHistory, logger);

  // Step 2: Attempt-based cleanup within each commit (keep 2 attempts)
  await cleanupAttempts(paths.releases, logger);
}

async function cleanupCommits(releasesPath, versionHistory, logger) {
  const commitDirs = await fs.readdir(releasesPath);

  if (commitDirs.length <= CLEANUP.keepCommits) {
    logger.debug(
      `Found ${commitDirs.length} commits, no commit cleanup needed (keep ${CLEANUP.keepCommits})`
    );
    return;
  }

  // Get unique commits from version history, sorted by timestamp (newest first)
  const trackedCommits = versionHistory.deployments
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .reduce((unique, deployment) => {
      if (!unique.some((item) => item.commit === deployment.commit)) {
        unique.push({
          commit: deployment.commit,
          timestamp: deployment.timestamp,
        });
      }
      return unique;
    }, []);

  // Keep only the most recent commits up to the limit
  const commitsToKeep = new Set(
    trackedCommits.slice(0, CLEANUP.keepCommits).map((item) => item.commit)
  );

  // Remove commit directories not in the keep list
  const commitsToRemove = commitDirs.filter(
    (commitDir) => !commitsToKeep.has(commitDir)
  );

  for (const commitDir of commitsToRemove) {
    const commitPath = join(releasesPath, commitDir);
    logger.debug(`Removing old commit directory: ${commitDir}`);
    await fs.remove(commitPath);
  }

  if (commitsToRemove.length > 0) {
    logger.debug(
      `Cleaned up ${commitsToRemove.length} old commits based on version history`
    );
  }
}

async function cleanupAttempts(releasesPath, logger) {
  const commitDirs = await fs.readdir(releasesPath);

  for (const commitDir of commitDirs) {
    const commitPath = join(releasesPath, commitDir);

    if (!(await fs.pathExists(commitPath))) {
      continue; // Skip if directory was removed during commit cleanup
    }

    const attemptDirs = await fs.readdir(commitPath);

    if (attemptDirs.length <= CLEANUP.keepAttempts) {
      logger.debug(
        `Commit ${commitDir}: ${attemptDirs.length} attempts, no cleanup needed (keep ${CLEANUP.keepAttempts})`
      );
      continue;
    }

    // Get attempt directories with their creation times
    const attemptsWithStats = [];
    for (const attemptDir of attemptDirs) {
      const attemptPath = join(commitPath, attemptDir);
      const stat = await fs.stat(attemptPath);
      attemptsWithStats.push({
        name: attemptDir,
        path: attemptPath,
        created: stat.birthtime || stat.ctime,
      });
    }

    // Sort by creation time, newest first
    attemptsWithStats.sort((a, b) => b.created.getTime() - a.created.getTime());

    // Remove old attempts beyond the keep limit
    const attemptsToRemove = attemptsWithStats.slice(CLEANUP.keepAttempts);

    for (const attempt of attemptsToRemove) {
      logger.debug(`Removing old attempt: ${commitDir}/${attempt.name}`);
      await fs.remove(attempt.path);
    }

    if (attemptsToRemove.length > 0) {
      logger.debug(
        `Commit ${commitDir}: Cleaned up ${attemptsToRemove.length} old attempts`
      );
    }
  }
}

export async function cleanupFailedDeployment(releasePath, logger) {
  logger.debug(`Cleaning up failed deployment: ${releasePath}`);

  if (await fs.pathExists(releasePath)) {
    await fs.remove(releasePath);
    logger.debug("Failed deployment directory removed");
  }
}
