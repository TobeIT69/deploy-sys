import {
  getOctokit,
  getRepositoryInfo,
  isGitHubConfigured,
} from "./githubClient.js";

export async function updateDeploymentStatus(
  deploymentId,
  state,
  description = null
) {
  // Skip if GitHub is not configured
  if (!isGitHubConfigured()) {
    return null;
  }

  try {
    const octokit = await getOctokit();
    const { owner, repo } = getRepositoryInfo();

    const payload = {
      owner,
      repo,
      deployment_id: deploymentId,
      state, // 'pending', 'in_progress', 'success', 'failure', 'error', 'inactive'
    };

    if (description) {
      payload.description = description;
    }

    // Set appropriate default descriptions
    if (!description) {
      if (state === "success") {
        payload.description = "Deployment completed successfully";
      } else if (state === "failure" || state === "error") {
        payload.description = "Deployment failed";
      } else if (state === "in_progress") {
        payload.description = "Deployment in progress";
      }
    }

    const response = await octokit.rest.repos.createDeploymentStatus(payload);
    return response.data;
  } catch (error) {
    // Log error but don't fail the deployment process
    console.warn(
      `Failed to update deployment status to '${state}': ${error.message}`
    );
    return null;
  }
}
