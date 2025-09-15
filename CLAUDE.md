# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## High-Level Architecture

This is a deployment system for the TobeIT69 project that implements trunk-based deployment across three environments (main, staging, prod). The system consists of two main components:

1. **Artifact Collection Script** (`scripts/collect-build-artifacts.sh`) - Collects pre-built artifacts from a monorepo workspace and packages them for deployment
2. **Deployment CLI** (`deploy/`) - Node.js CLI tool that deploys from artifacts with atomic deployments, rollbacks, and PM2 process management

### Key Architectural Principles

- **Artifact-Based Deployment**: Build once in CI, deploy lightweight artifacts containing only build outputs and dependencies
- **Atomic Operations**: Symlink-based deployments with automatic rollback on failure
- **Package Independence**: Client and server packages are deployed independently with different commit hashes
- **Environment Isolation**: Separate configurations, processes, and port allocations per environment
- **Trunk-Based Strategy**: Three branch-to-environment mappings (main→main, staging→staging, prod→prod)

### Directory Structure

```
~/tobeit69/                          # Base deployment directory on VPS
├── deployments/                     # Environment-specific deployments
│   ├── main/staging/prod/           # Per-environment folders
│   │   ├── ecosystem.config.js      # PM2 configuration
│   │   ├── client/                  # Package-specific deployments
│   │   │   ├── current -> releases/{commit}/{timestamp}/  # Symlink to active
│   │   │   └── releases/            # Timestamped releases by commit
│   │   └── server/                  # Independent server deployments
├── versions/                        # Deployment tracking JSON files
│   └── {env}-{package}.json         # Version history per package/environment
└── dotenv/                          # Environment files managed via SCP
    ├── client/.env.{environment}    # Package-specific environment files
    └── server/.env.{environment}
```

## Common Development Commands

### Artifact Collection Script

```bash
# Make script executable
chmod +x scripts/collect-build-artifacts.sh

# Collect client artifacts (auto-detects environment from git branch)
./scripts/collect-build-artifacts.sh client ./artifacts/

# Collect server artifacts with specific environment
./scripts/collect-build-artifacts.sh server ./artifacts/ --env staging

# Validate setup without collecting
./scripts/collect-build-artifacts.sh client ./artifacts/ --dry-run --verbose

# Keep temporary files for debugging
./scripts/collect-build-artifacts.sh server ./artifacts/ --keep-temp
```

### Deployment CLI

```bash
# Setup deployment CLI
cd deploy/
pnpm install
chmod +x bin/deploy.js

# Deploy from artifact
./bin/deploy.js deploy --artifact path/to/tobeit69-client-prod-abc123.tar.gz [--dry-run] [--verbose]

# Rollback to previous deployment
./bin/deploy.js rollback --package client --env prod [--commit abc123] [--verbose]

# Check current deployment status
./bin/deploy.js status --package client --env prod [--verbose]

# List deployment history
./bin/deploy.js list --package client --env prod [--limit 5] [--verbose]

# Generate PM2 configs for all environments
node generate-pm2-configs.js
```

## Artifact Collection Workflow

The `collect-build-artifacts.sh` script implements a two-phase strategy:

1. **Build Phase**: Normal build in full monorepo workspace with existing caching
2. **Collection Phase**: Create pruned workspace using `turbo prune --docker` and copy build outputs

### Artifact Structure

Generated artifacts follow this naming: `tobeit69-{package}-{environment}-{commit}.tar.gz`

Contents:
```
artifact.tar.gz
├── metadata.json              # Deployment context (env, package, commit, timestamps)
├── packages/{package}/        # Package with build outputs (.next/, dist/)
├── package.json               # Root package.json
└── pnpm-lock.yaml            # Pruned dependency lockfile
```

## Deployment Process

### Two-Workflow CI/CD Strategy

- **build.yml**: Universal CI for all branches + artifact publishing for trunk branches (main, staging, prod)
- **deploy.yml**: CD workflow triggered by successful builds, downloads artifacts and deploys

### Deployment Steps

1. **Artifact Validation**: Extract and validate metadata.json
2. **Release Preparation**: Create timestamped release directory under commit hash
3. **Environment Setup**: Copy appropriate `.env.{environment}` file from `~/tobeit69/dotenv/`
4. **Dependencies**: Install production dependencies with `pnpm install --prod`
5. **Health Check**: Test service on random port (9000-9999) before deployment
6. **Atomic Deployment**: Update symlink `current -> releases/{commit}/{timestamp}/`
7. **PM2 Management**: Reload service `tobeit69-{package}-{environment}`
8. **Production Verification**: Health check on production port
9. **Cleanup**: Remove old deployments (keep 5 commits, 2 attempts per commit)

## Port Allocation

- **main**: client:3000, server:8080
- **staging**: client:3001, server:8081
- **prod**: client:3002, server:8082

## PM2 Service Management

Services use naming pattern: `tobeit69-{package}-{environment}`

Each environment has `ecosystem.config.js` pointing to `current/` symlink for dynamic path resolution.

## Environment Variable Management

Environment files are stored in `~/tobeit69/dotenv/{package}/.env.{environment}` and copied to each deployment for isolation. Files are managed via SCP and not included in artifacts.

## Health Check Configuration

- **Timeout**: 30 seconds
- **Test Port Range**: 9000-9999 for isolated testing
- **Retries**: 3 attempts with 1 second intervals
- **Client**: `GET /` expects 200 response
- **Server**: `GET /health` expects 200 response

## Version Tracking and Rollbacks

Each deployment is tracked in `~/tobeit69/versions/{env}-{package}.json` with complete history. Rollbacks can target:
- Previous deployment (default)
- Specific commit hash (full or short)
- Specific deployment attempt within a commit

## GitHub Actions Integration

The system includes a reusable action at `.github/actions/collect-build-artifacts/` for CI integration that outputs artifact paths for upload.