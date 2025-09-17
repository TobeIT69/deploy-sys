import { deploy } from "./deploy.js";
import { Logger } from "../utils/logger.js";
import { parseEnvironment } from "../utils/parseEnvironment.js";

export async function webhookDeploy(payload) {
  const logger = new Logger(true); // Always verbose for webhook deployments
  const { deployment } = payload;
  const { id: deploymentId, environment, ref: commit } = deployment;

  // Parse environment format {env}-{package}
  const { env, package: packageName } = parseEnvironment(environment);

  // Parse payload if it's a string (from GitHub CLI)
  let deploymentPayload = deployment.payload;
  if (typeof deploymentPayload === "string") {
    try {
      deploymentPayload = JSON.parse(deploymentPayload);
    } catch (error) {
      throw new Error(`Invalid JSON in deployment payload: ${error.message}`);
    }
  }

  const workflowRunId = deploymentPayload?.workflow_run_id;

  try {
    logger.info(
      `🚀 Starting webhook deployment for ${packageName} -> ${environment} (${commit})`
    );

    // Call the enhanced deploy command with GitHub Actions run ID
    logger.step("Executing deployment using GitHub Actions run ID");
    await deploy({
      runId: workflowRunId,
      package: packageName,
      env: env,
      deploymentId: deploymentId,
      verbose: true,
      dryRun: false,
    });

    logger.success(`✨ Webhook deployment completed successfully!`);
    logger.info(`Package: ${packageName}`);
    logger.info(`Environment: ${env}`);
    logger.info(`Full Environment: ${environment}`);
    logger.info(`Commit: ${commit}`);
  } catch (error) {
    logger.error(`❌ Webhook deployment failed: ${error.message}`);
    throw error;
  }
}

export function validateDeploymentPayload(payload) {
  const { deployment, repository } = payload;

  if (!deployment) {
    throw new Error("Missing deployment object in webhook payload");
  }

  if (!repository) {
    throw new Error("Missing repository object in webhook payload");
  }

  if (!deployment.environment) {
    throw new Error("Missing environment in deployment payload");
  }

  // Validate environment format {env}-{package}
  try {
    parseEnvironment(deployment.environment);
  } catch (error) {
    throw new Error(`Invalid environment format: ${error.message}`);
  }

  // Parse payload if it's a string (from GitHub CLI)
  let deploymentPayload = deployment.payload;
  if (typeof deploymentPayload === "string") {
    try {
      deploymentPayload = JSON.parse(deploymentPayload);
    } catch (error) {
      throw new Error(`Invalid JSON in deployment payload: ${error.message}`);
    }
  }

  if (!deploymentPayload?.workflow_run_id) {
    throw new Error("Missing workflow_run_id in deployment payload");
  }

  return true;
}
