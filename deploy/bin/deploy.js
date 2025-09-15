#!/usr/bin/env node

import { Command } from "commander";
import { deploy } from "../commands/deploy.js";
import { rollback } from "../commands/rollback.js";
import { status } from "../commands/status.js";
import { list } from "../commands/list.js";

const program = new Command();

program.name("deploy").description("TobeIT69 deployment CLI").version("1.0.0");

program
  .command("deploy")
  .description("Deploy from pre-built artifact")
  .requiredOption(
    "-a, --artifact <path>",
    "Path to deployment artifact (.tar.gz)"
  )
  .option("--dry-run", "Validate without deploying", false)
  .option("-v, --verbose", "Detailed logging", false)
  .action(deploy);

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
  .action(rollback);

program
  .command("status")
  .description("Show current active deployment status")
  .requiredOption("-p, --package <name>", "Package name (client|server)")
  .requiredOption("-e, --env <environment>", "Environment (main|staging|prod)")
  .option("-v, --verbose", "Show detailed status information", false)
  .action(status);

program
  .command("list")
  .description("List deployment history")
  .requiredOption("-p, --package <name>", "Package name (client|server)")
  .requiredOption("-e, --env <environment>", "Environment (main|staging|prod)")
  .option("-l, --limit <number>", "Limit number of deployments shown", "10")
  .option("-v, --verbose", "Show detailed deployment information", false)
  .action(list);

program.parse();
