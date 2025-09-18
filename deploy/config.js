import { homedir } from "os";
import { join } from "path";

export const BASE_PATH =
  process.env.DEPLOYMENT_BASE_PATH || join(homedir(), "tobeit69");

export const PATHS = {
  deployments: join(BASE_PATH, "deployments"),
  versions: join(BASE_PATH, "versions"),
  dotenv: join(BASE_PATH, "dotenv"),
};

export const PORTS = {
  main: { client: 3000, server: 8080 },
  staging: { client: 3001, server: 8081 },
  prod: { client: 3002, server: 8082 },
};

export const HEALTH_CHECK = {
  timeout: 30000,
  portRange: { min: 9000, max: 9999 },
  retries: 3,
  interval: 1000,
};

export const CLEANUP = {
  keepCommits: 5,
  keepAttempts: 2,
};

export const CDN_HEALTH_CHECK = {
  enabled: true,
  sampleSize: 5, // Number of random assets to check
  timeout: 10000, // 10 seconds per asset
  retries: 2,
  interval: 1000, // 1 second between retries
};

export const DISCORD = {
  webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  enabled: !!process.env.DISCORD_WEBHOOK_URL,
  timeout: 10000, // 10 seconds timeout for Discord webhook requests
};
