#!/usr/bin/env node

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { PATHS, PORTS } from "./config.js";
import { getDeploymentPaths } from "./utils/paths.js";

const ENVIRONMENTS = ["main", "staging", "prod"];
const PACKAGES = ["client", "server"];

function generatePM2Config(environment) {
  const apps = [];

  for (const packageName of PACKAGES) {
    const { current } = getDeploymentPaths(environment, packageName);
    const port = PORTS[environment][packageName];

    apps.push({
      name: `tobeit69-${packageName}-${environment}`,
      cwd: join(current, "packages", packageName),
      script: "npm",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      env: {
        DEPLOY_ENV: environment,
        NODE_ENV: "production",
        PORT: port,
      },
      error_file: join(
        PATHS.deployments,
        environment,
        `logs/${packageName}-error.log`
      ),
      out_file: join(
        PATHS.deployments,
        environment,
        `logs/${packageName}-out.log`
      ),
      log_file: join(
        PATHS.deployments,
        environment,
        `logs/${packageName}-combined.log`
      ),
      time: true,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
    });
  }

  return {
    apps,
  };
}

async function createPM2Configs() {
  console.log("🔧 Generating PM2 ecosystem configs...");

  for (const environment of ENVIRONMENTS) {
    try {
      const envDeploymentPath = join(PATHS.deployments, environment);
      const logsPath = join(envDeploymentPath, "logs");
      const configPath = join(envDeploymentPath, "ecosystem.config.js");

      // Ensure directories exist
      await mkdir(envDeploymentPath, { recursive: true });
      await mkdir(logsPath, { recursive: true });

      // Generate config content
      const config = generatePM2Config(environment);
      const configContent = `module.exports = ${JSON.stringify(
        config,
        null,
        2
      )};`;

      // Write config file
      await writeFile(configPath, configContent, "utf8");

      console.log(`✅ Created PM2 config for ${environment}: ${configPath}`);
    } catch (error) {
      console.error(
        `❌ Failed to create PM2 config for ${environment}:`,
        error.message
      );
      process.exit(1);
    }
  }

  console.log("🎉 All PM2 ecosystem configs generated successfully!");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createPM2Configs().catch(console.error);
}

export { createPM2Configs, generatePM2Config };
