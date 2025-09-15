# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## High-Level Architecture

This is a Node.js CLI tool for deploying TobeIT69 applications using atomic deployments with PM2 process management. The system uses a trunk-based deployment strategy across three environments (main, staging, prod) with artifact-based deployments for zero-downtime operations.

### Core Components

- **CLI Entry Point**: `bin/deploy.js` - Commander.js-based CLI with four main commands
- **Commands**: Individual command implementations in `commands/` directory
- **Utilities**: Shared functionality in `utils/` for file operations, health checks, logging, etc.
- **Configuration**: `config.js` defines paths, ports, health check settings, and cleanup policies

### Directory Structure

```
~/tobeit69/                          # Base deployment directory
├── deployments/                     # Environment-specific deployments
│   ├── main/staging/prod/           # Per-environment folders
│   │   ├── ecosystem.config.js      # PM2 configuration
│   │   ├── client/                  # Package-specific deployments
│   │   │   ├── current -> releases/{commit}/{timestamp}/  # Symlink to active
│   │   │   └── releases/            # Timestamped releases
│   │   └── server/                  # Independent server deployments
├── versions/                        # Deployment tracking
│   └── {env}-{package}.json         # Version history per package/environment
└── dotenv/                          # Environment files
    ├── client/.env.{environment}    # Package-specific environment files
    └── server/.env.{environment}
```

### Key Architectural Principles

- **Package Independence**: Client and server deployments are completely independent
- **Atomic Deployments**: Symlink-based switching with automatic rollback on failure
- **Artifact-Based**: Deploy from pre-built .tar.gz artifacts, no building during deployment
- **Environment Isolation**: Separate configurations and processes per environment
- **Version Tracking**: Complete history with rollback capabilities to any previous deployment

## Common Development Commands

### CLI Usage

```bash
# Make CLI executable
chmod +x bin/deploy.js

# Install dependencies
pnpm install

# Deploy from artifact
./bin/deploy.js deploy --artifact path/to/artifact.tar.gz [--dry-run] [--verbose]

# Rollback deployment
./bin/deploy.js rollback --package client --env prod [--commit abc123] [--verbose]

# Check deployment status
./bin/deploy.js status --package client --env prod [--verbose]

# List deployment history
./bin/deploy.js list --package client --env prod [--limit 5] [--verbose]
```

### PM2 Configuration Generation

```bash
# Generate PM2 configs for all environments
node generate-pm2-configs.js
```

### Environment Configuration

Environment files are managed separately in `~/tobeit69/dotenv/`:
- `client/.env.main` - Client development environment
- `client/.env.staging` - Client staging environment
- `client/.env.prod` - Client production environment
- `server/.env.{environment}` - Server environment files

## Artifact Format

Deployment artifacts must be `.tar.gz` files with this structure:
```
artifact.tar.gz
├── metadata.json              # Environment, package, commit info
├── packages/{package}/        # Package directory with build outputs
├── package.json               # Root package.json
└── pnpm-lock.yaml            # Dependency lockfile
```

## Port Allocation

- **main**: client:3000, server:8080
- **staging**: client:3001, server:8081
- **prod**: client:3002, server:8082

## Health Check Configuration

- **Timeout**: 30 seconds
- **Test Port Range**: 9000-9999 (for isolated testing)
- **Retries**: 3 attempts with 1 second intervals
- **Client Health Check**: `GET /` (expects 200 response)
- **Server Health Check**: `GET /health` (expects 200 response)

## Cleanup Policy

- **Keep Commits**: 5 recent Git commits per package/environment
- **Keep Attempts**: 2 deployment attempts per commit (success + failure for debugging)

## Key Configuration Files

- `config.js` - Central configuration (paths, ports, timeouts)
- `package.json` - Dependencies and CLI binary definition
- `generate-pm2-configs.js` - PM2 ecosystem config generator
- `scripts/collect-build-artifacts.sh` - Artifact collection script

## PM2 Service Naming

Services follow the pattern: `tobeit69-{package}-{environment}`
- Examples: `tobeit69-client-prod`, `tobeit69-server-staging`

## Error Handling

- **Deploy Failures**: Automatic cleanup of failed deployment directory
- **PM2 Rollback**: Service rollback if deployment fails after PM2 restart
- **Health Check Failures**: Detailed logging and automatic rollback
- **Validation**: Comprehensive artifact and target validation before operations