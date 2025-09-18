#!/usr/bin/env node

import "../utils/requireDotEnv.js";
import { App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import fs from "fs";
import http from "http";
import {
  webhookDeploy,
  validateDeploymentPayload,
} from "../commands/webhookDeploy.js";

const appId = process.env.APP_ID;
const webhookSecret = process.env.WEBHOOK_SECRET;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;

if (!appId) {
  throw new Error("APP_ID is missing.");
}

if (!privateKeyPath) {
  throw new Error("PRIVATE_KEY_PATH is missing.");
}

if (!webhookSecret) {
  console.warn("WEBHOOK_SECRET is not set.");
}

const privateKey = fs.readFileSync(privateKeyPath, "utf8");

const app = new App({
  appId: appId,
  privateKey: privateKey,
  webhooks: {
    secret: webhookSecret,
  },
});

// Simple deployment queue
const deploymentQueue = [];
let isProcessing = false;

app.webhooks.on("deployment.created", async ({ payload, id }) => {
  console.log(`📥 Received deployment webhook: ${id}`);

  try {
    try {
      payload.deployment.payload = JSON.parse(payload.deployment.payload);
    } catch {}

    // Check for skip_webhook flag
    if (payload.deployment.payload?.skip_webhook === true) {
      console.log(
        `⏭️  Skipping webhook deployment due to skip_webhook flag: ${id}`
      );
      return;
    }

    // Validate the deployment payload
    validateDeploymentPayload(payload);

    const { deployment } = payload;
    console.log(
      `🎯 Queuing deployment: ${deployment.payload.package} -> ${deployment.environment} (${deployment.ref})`
    );

    // Add to deployment queue
    queueDeployment({ payload });
  } catch (error) {
    console.error(`❌ Invalid deployment webhook payload: ${error.message}`);

    // Try to update deployment status to failure if possible
    if (payload?.deployment?.id && payload?.repository) {
      try {
        const { updateDeploymentStatus } = await import(
          "../utils/deploymentStatus.js"
        );
        await updateDeploymentStatus(
          payload.deployment.id,
          "failure",
          `Invalid deployment payload: ${error.message}`
        );
      } catch (statusError) {
        console.error(
          `Failed to update deployment status: ${statusError.message}`
        );
      }
    }
  }
});

function queueDeployment(deploymentData) {
  deploymentQueue.push(deploymentData);
  console.log(`📋 Deployment queued. Queue length: ${deploymentQueue.length}`);

  // Start processing if not already running
  if (!isProcessing) {
    processDeploymentQueue();
  }
}

async function processDeploymentQueue() {
  if (isProcessing || deploymentQueue.length === 0) {
    return;
  }

  isProcessing = true;
  console.log(`🔄 Starting deployment queue processing`);

  while (deploymentQueue.length > 0) {
    const deploymentData = deploymentQueue.shift();
    const { deployment } = deploymentData.payload;

    console.log(`⚡ Processing deployment: ${deployment.environment}`);

    try {
      await webhookDeploy(deploymentData.payload);
      console.log(`✅ Deployment completed successfully`);
    } catch (error) {
      console.error(`❌ Deployment failed:`, error.message);
      // Continue processing other deployments in queue
    }

    console.log(`📋 Remaining deployments in queue: ${deploymentQueue.length}`);
  }

  isProcessing = false;
  console.log(`🏁 Deployment queue processing completed`);
}

app.webhooks.onError((error) => {
  if (error.name === "AggregateError") {
    console.error(`Error processing request: ${error.event}`);
  } else {
    console.error(error);
  }
});

const port = process.env.WEBHOOK_PORT || 3100;
const host = process.env.WEBHOOK_HOST || "localhost";
const webhookPath = process.env.WEBHOOK_PATH || "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${webhookPath}`;

const middleware = createNodeMiddleware(app.webhooks, { path: webhookPath });

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`);
  console.log("Press Ctrl + C to quit.");
});
