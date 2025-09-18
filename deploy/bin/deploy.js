#!/usr/bin/env node

import "../utils/requireDotEnv.js";
import { Command } from "commander";
import { deploy } from "../commands/deploy.js";
import { rollback } from "../commands/rollback.js";
import { status } from "../commands/status.js";
import { list } from "../commands/list.js";

const program = new Command();

program.name("deploy").description("TobeIT69 deployment CLI").version("1.0.0");

program
  .command("deploy")
  .description("Deploy from pre-built artifact or GitHub Actions run")
  .option("-a, --artifact <path>", "Path to deployment artifact (.tar.gz)")
  .option(
    "-r, --run-id <id>",
    "GitHub Actions run ID to download artifact from"
  )
  .option(
    "-p, --package <name>",
    "Package name (client|server) - required when using --run-id"
  )
  .option("-d, --deployment-id <id>", "GitHub deployment ID for status updates")
  .option("--dry-run", "Validate without deploying", false)
  .option("-v, --verbose", "Detailed logging", false)
  .action(async (options) => {
    try {
      // Validate that either artifact or run-id is provided
      if (!options.artifact && !options.runId) {
        console.error("Error: Either --artifact or --run-id must be specified");
        process.exit(1);
      }

      if (options.artifact && options.runId) {
        console.error("Error: Cannot specify both --artifact and --run-id");
        process.exit(1);
      }

      // Validate required options for run-id mode
      if (options.runId) {
        if (!options.package) {
          console.error("Error: --package is required when using --run-id");
          process.exit(1);
        }
      }

      const result = await deploy(options);
      if (result?.success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    } catch (error) {
      process.exit(1);
    }
  });

program
  .command("rollback")
  .description("Rollback to a previous deployment")
  .requiredOption("-p, --package <name>", "Package name (client|server)")
  .requiredOption("-e, --env <environment>", "Environment (main|staging|prod)")
  .option("-c, --commit <hash>", "Specific commit to rollback to")
  .option(
    "-a, --attempt <timestamp>",
    "Specific deployment attempt (format: YYYY-MM-DD-HH-mm)"
  )
  .option("-v, --verbose", "Detailed logging", false)
  .action(async (options) => {
    try {
      const result = await rollback(options);
      if (result?.success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    } catch (error) {
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current active deployment status")
  .requiredOption("-p, --package <name>", "Package name (client|server)")
  .requiredOption("-e, --env <environment>", "Environment (main|staging|prod)")
  .option("-v, --verbose", "Show detailed status information", false)
  .action(async (options) => {
    try {
      await status(options);
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List deployment history")
  .requiredOption("-p, --package <name>", "Package name (client|server)")
  .requiredOption("-e, --env <environment>", "Environment (main|staging|prod)")
  .option("-l, --limit <number>", "Limit number of deployments shown", "10")
  .option("-v, --verbose", "Show detailed deployment information", false)
  .action(async (options) => {
    try {
      await list(options);
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  });

program.parse();
