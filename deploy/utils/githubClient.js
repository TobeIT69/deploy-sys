import { App } from "octokit";
import fs from "fs";
import path from "path";

let githubAppInstance = null;
let octokitInstance = null;

function createGitHubApp() {
  if (githubAppInstance) {
    return githubAppInstance;
  }

  const appId = process.env.APP_ID;
  const privateKeyPath = process.env.PRIVATE_KEY_PATH;

  if (!appId || !privateKeyPath) {
    throw new Error(
      "GitHub App credentials not configured. Set APP_ID and PRIVATE_KEY_PATH environment variables."
    );
  }

  let privateKey;
  try {
    privateKey = fs.readFileSync(path.resolve(privateKeyPath), "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read GitHub App private key from ${privateKeyPath}: ${error.message}`
    );
  }

  githubAppInstance = new App({
    appId,
    privateKey,
  });

  return githubAppInstance;
}

export async function getOctokit() {
  if (octokitInstance) {
    return octokitInstance;
  }

  const app = createGitHubApp();
  const installationId = process.env.APP_INSTALLATION_ID;

  if (!installationId) {
    throw new Error(
      "GitHub App installation ID not configured. Set APP_INSTALLATION_ID environment variable."
    );
  }

  try {
    octokitInstance = await app.getInstallationOctokit(
      parseInt(installationId)
    );
    return octokitInstance;
  } catch (error) {
    throw new Error(
      `Failed to authenticate GitHub App with installation ID ${installationId}: ${error.message}`
    );
  }
}

export function isGitHubConfigured() {
  return !!(
    process.env.APP_ID &&
    process.env.PRIVATE_KEY_PATH &&
    process.env.APP_INSTALLATION_ID &&
    process.env.GITHUB_OWNER &&
    process.env.GITHUB_REPO
  );
}

export function getRepositoryInfo() {
  return {
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
  };
}
