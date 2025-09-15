# TobeIT69 Deploy CLI

A comprehensive deployment CLI tool for the TobeIT69 monorepo project, providing atomic deployments, rollbacks, and deployment management.

## Overview

This CLI manages deployments from pre-built artifacts with the following key features:

- **Atomic Deployments**: Symlink-based deployments with automatic rollback on failure
- **Health Checks**: Isolated testing before production deployment
- **Version Tracking**: Complete deployment history with commit and timestamp tracking
- **Cleanup Management**: Automatic cleanup of old deployments (5 commits, 2 attempts per commit)
- **PM2 Integration**: Seamless service management and reloading
- **Package-Independent Rollbacks**: Rollback any package to any previous deployment

## Installation

```bash
cd scripts/deploy
pnpm install
chmod +x bin/deploy.js
```

## Commands

### `deploy` - Deploy from Artifact

Deploy from a pre-built artifact (`.tar.gz` file) with automated health checks and cleanup.

#### Usage

```bash
./bin/deploy.js deploy --artifact <path> [--dry-run] [--verbose]
```

#### Options

- `-a, --artifact <path>` - Path to deployment artifact (.tar.gz) **[Required]**
- `--dry-run` - Validate artifact without deploying
- `-v, --verbose` - Detailed logging output

#### Process Flow

1. **Artifact Validation** - Extract and validate metadata.json
2. **Release Preparation** - Create timestamped release directory
3. **Artifact Extraction** - Extract artifact to release directory
4. **Environment Setup** - Copy environment file from dotenv to package
5. **Dependency Installation** - Install production dependencies with pnpm
6. **Isolated Health Check** - Test on random port before deployment
7. **Atomic Deployment** - Update symlink to new release
8. **PM2 Service Management** - Reload or start PM2 service
9. **Production Health Check** - Verify service on production port
10. **Version Tracking** - Update deployment history
11. **Cleanup** - Remove old deployments per retention policy

#### Examples

```bash
# Deploy client to production
./bin/deploy.js deploy --artifact ./artifacts/tobeit69-client-prod-abc123.tar.gz

# Dry run validation
./bin/deploy.js deploy --artifact ./artifacts/tobeit69-client-prod-abc123.tar.gz --dry-run

# Verbose deployment
./bin/deploy.js deploy --artifact ./artifacts/tobeit69-client-prod-abc123.tar.gz --verbose
```

### `rollback` - Rollback Deployment

Rollback to a previous deployment with atomic symlink updates and service management.

#### Usage

```bash
./bin/deploy.js rollback --package <name> --env <environment> [options]
```

#### Options

- `-p, --package <name>` - Package name (client|server) **[Required]**
- `-e, --env <environment>` - Environment (main|staging|prod) **[Required]**
- `-c, --commit <hash>` - Specific commit to rollback to (supports both full and short hashes)
- `-a, --attempt <timestamp>` - Specific deployment attempt (YYYY-MM-DD-HH-mm)
- `-v, --verbose` - Detailed logging output

#### Rollback Types

1. **Previous Deployment** (default)

   ```bash
   ./bin/deploy.js rollback --package client --env prod
   ```

   Rolls back to the most recent inactive deployment.

2. **Specific Commit**

   ```bash
   ./bin/deploy.js rollback --package client --env prod --commit abc123d
   ```

   Rolls back to the latest attempt of the specified commit.

3. **Specific Attempt**
   ```bash
   ./bin/deploy.js rollback --package client --env prod --commit abc123d --attempt 2025-09-13-14-30
   ```
   Rolls back to an exact deployment attempt.

#### Process Flow

1. **Target Selection** - Find rollback target from version history
2. **Validation** - Verify target deployment exists and is valid
3. **Candidate Display** - Show available rollback options
4. **Health Check** - Basic validation of rollback target
5. **Atomic Rollback** - Update symlink to target release
6. **PM2 Service Management** - Reload or restart service
7. **Production Health Check** - Verify service is healthy
8. **Version Tracking Update** - Mark rollback target as active

#### Examples

```bash
# Rollback to previous deployment
./bin/deploy.js rollback --package client --env prod --verbose

# Rollback to specific commit (supports both full and short hashes)
./bin/deploy.js rollback --package client --env prod --commit 943af64
./bin/deploy.js rollback --package client --env prod --commit 943af6403a2c

# Rollback to specific deployment attempt
./bin/deploy.js rollback --package client --env prod --commit 943af64 --attempt 2025-09-13-14-30
```

### `status` - Get Current Active Deployment

Show the currently active deployment for a specific package and environment.

#### Usage

```bash
./bin/deploy.js status --package <name> --env <environment> [--verbose]
```

#### Options

- `-p, --package <name>` - Package name (client|server) **[Required]**
- `-e, --env <environment>` - Environment (main|staging|prod) **[Required]**
- `-v, --verbose` - Show additional deployment details

#### Output Format

```
Current Active Deployment:
  Package: client
  Environment: prod
  Version: 2025-09-13-09-943af64
  Commit: 943af6403a2cd77fbfbf03bcdfe05dc48cac8ffe
  Deployed: 2025-09-13T09:54:06.550Z
  Release Path: ~/tobeit69/deployments/prod/client/releases/943af64/2025-09-13-09
  PM2 Status: online
  Health: ✅ Healthy (http://localhost:3002)
```

#### Verbose Output

The verbose flag (`--verbose`) shows additional information:

- Full commit hash
- Build info (Node/pnpm versions, build time)
- Detailed PM2 service info
- Full file paths

#### Examples

```bash
# Get current deployment status
./bin/deploy.js status --package client --env prod

# Get detailed status information
./bin/deploy.js status --package client --env prod --verbose
```

### `list` - List All Deployments

Show deployment history for a specific package and environment.

#### Usage

```bash
./bin/deploy.js list --package <name> --env <environment> [--limit <n>] [--verbose]
```

#### Options

- `-p, --package <name>` - Package name (client|server) **[Required]**
- `-e, --env <environment>` - Environment (main|staging|prod) **[Required]**
- `-l, --limit <number>` - Limit number of deployments shown (default: 10)
- `-v, --verbose` - Show additional deployment details

#### Output Format

```
Deployment History (client/prod):

✅ 2025-09-13-09-943af64 [ACTIVE]
   Commit: 943af64 (943af6403a2cd77fbfbf03bcdfe05dc48cac8ffe)
   Deployed: 2025-09-13 09:54:06
   Status: active

   2025-09-13-08-abc1234 [INACTIVE]
   Commit: abc1234 (abc1234567890abcdef1234567890abcdef1234)
   Deployed: 2025-09-13 08:30:15
   Status: inactive

   2025-09-12-16-def5678 [INACTIVE]
   Commit: def5678 (def567890abcdef1234567890abcdef567890abc)
   Deployed: 2025-09-12 16:45:22
   Status: inactive

Total: 3 deployments found
```

#### Verbose Output

The verbose flag (`--verbose`) shows additional information:

- Full paths to deployment directories
- Build information and metadata
- Rollback candidate indicators
- File sizes and dependency counts

#### Examples

```bash
# List recent deployments
./bin/deploy.js list --package client --env prod

# List last 5 deployments with details
./bin/deploy.js list --package client --env prod --limit 5 --verbose

# List all server deployments for staging
./bin/deploy.js list --package server --env staging
```

## Environment Variable Management

The deployment system automatically manages environment variables for each package and environment:

- **Source**: Environment files are stored in `~/tobeit69/dotenv/{package}/.env.{environment}`
- **Deployment**: During deployment/rollback, the appropriate `.env.{environment}` file is copied to `./packages/{package}/.env.local` in the release directory
- **Automatic**: Environment variables are applied automatically during both deployment and rollback operations

### Environment File Structure

```
~/tobeit69/dotenv/
├── client/
│   ├── .env.main      # Client main environment variables
│   ├── .env.staging   # Client staging environment variables
│   └── .env.prod      # Client production environment variables
└── server/
    ├── .env.main      # Server main environment variables
    ├── .env.staging   # Server staging environment variables
    └── .env.prod      # Server production environment variables
```

**Important Notes:**

- Environment files are NOT included in deployment artifacts
- Each deployment gets a fresh copy of the current environment file
- Environment variables are automatically updated during rollbacks to match the target environment

## Directory Structure

### Deployment Layout

```
~/tobeit69/
├── deployments/
│   └── {environment}/
│       ├── ecosystem.config.js          # PM2 configuration
│       └── {package}/
│           ├── current -> releases/{short-commit}/{timestamp}/  # Symlink
│           └── releases/
│               └── {short-commit}/     # Short commit hash (7 chars)
│                   └── {timestamp}/    # Timestamped deployment
├── versions/
│   └── {environment}-{package}.json   # Version tracking
└── dotenv/
    ├── client/
    │   ├── .env.main                   # Client main environment
    │   ├── .env.staging                # Client staging environment
    │   └── .env.prod                   # Client production environment
    └── server/
        ├── .env.main                   # Server main environment
        ├── .env.staging                # Server staging environment
        └── .env.prod                   # Server production environment
```

### CLI Structure

```
scripts/deploy/
├── bin/
│   └── deploy.js                  # CLI entry point
├── commands/
│   ├── deploy.js                  # Deploy command implementation
│   └── rollback.js                # Rollback command implementation
├── utils/
│   ├── cleanup.js                 # Cleanup utilities
│   ├── fileOps.js                 # File operations
│   ├── healthCheck.js             # Health check utilities
│   ├── logger.js                  # Logging utilities
│   ├── paths.js                   # Path resolution
│   ├── rollback.js                # Rollback utilities
│   └── versions.js                # Version tracking
├── config.js                      # Configuration constants
└── package.json                   # Dependencies and scripts
```

## Configuration

Configuration is managed in `config.js`:

### Paths

- **Base Path**: `~/tobeit69` (configurable via `DEPLOYMENT_BASE_PATH`)
- **Deployments**: `~/tobeit69/deployments`
- **Versions**: `~/tobeit69/versions`
- **Environment Files**: `~/tobeit69/dotenv/{package}/.env.{environment}`

### Ports (by Environment)

- **main**: client:3000, server:8080
- **staging**: client:3001, server:8081
- **prod**: client:3002, server:8082

### Health Check Settings

- **Timeout**: 30 seconds
- **Test Port Range**: 9000-9999
- **Retries**: 3
- **Retry Interval**: 1 second

### Cleanup Policy

- **Keep Commits**: 5 recent commits
- **Keep Attempts**: 2 attempts per commit

## Artifact Format

Deployment artifacts must be `.tar.gz` files with this structure:

```
artifact.tar.gz
├── metadata.json              # Deployment metadata
├── packages/
│   └── {package}/             # Package directory
│       ├── package.json
│       ├── dist/              # Built application
│       └── ...
└── pnpm-lock.yaml            # Dependency lockfile
```

### metadata.json Format

```json
{
  "environment": "prod",
  "package": "client",
  "commit": "943af6403a2cd77fbfbf03bcdfe05dc48cac8ffe",
  "timestamp": "2025-09-13T09:33:00Z",
  "buildInfo": {
    "nodeVersion": "22.19.0",
    "pnpmVersion": "10.15.1",
    "buildTime": "2025-09-13T09:33:00Z"
  }
}
```

## PM2 Integration

The CLI manages PM2 services with this naming convention:

- Service Name: `tobeit69-{package}-{environment}`
- Example: `tobeit69-client-prod`

### PM2 Configuration

Each environment has a `ecosystem.config.js` file that defines services:

```javascript
module.exports = {
  apps: [
    {
      name: "tobeit69-client-prod",
      cwd: "/path/to/deployment/client/current/packages/client",
      script: "npm",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
      },
    },
  ],
};
```

## Version Tracking

Each package deployment is tracked in `~/tobeit69/versions/{env}-{package}.json`:

```json
{
  "current": "2025-09-13-09-943af64",
  "deployments": [
    {
      "version": "2025-09-13-09-943af64",
      "commit": "943af6403a2cd77fbfbf03bcdfe05dc48cac8ffe",
      "timestamp": "2025-09-13T09:54:06.550Z",
      "packages": ["client"],
      "status": "active",
      "releasePath": "/home/user/tobeit69/deployments/prod/client/releases/..."
    }
  ]
}
```

## Health Checks

### Deploy Health Checks

1. **Isolated Check**: Start service on random port (9000-9999) for testing
2. **Production Check**: Verify service responds on production port after deployment

### Health Check URLs

- **Client**: `http://localhost:{port}/`
- **Server**: `http://localhost:{port}/health`

## Error Handling

### Deploy Failures

- Automatic cleanup of failed deployment directory
- PM2 service rollback if deployment fails after service restart
- Detailed error logging with stack traces (verbose mode)

### Rollback Failures

- Validation of rollback target before attempting rollback
- PM2 service status verification after rollback
- Rollback target directory structure validation

## Logging

The CLI provides structured logging with different levels:

- **ℹ️ Info**: General information
- **✅ Success**: Successful operations
- **❌ Error**: Error messages
- **⚠️ Warn**: Warning messages
- **🔍 Debug**: Debug information (verbose mode only)
- **🔄 Step**: Process step indicators

### Verbose Mode

Enable detailed logging with the `--verbose` flag to see:

- Debug messages
- Command outputs (stdout/stderr)
- Internal process details
- Error stack traces

## Examples

### Complete Deployment Workflow

1. **Build and create artifact** (separate process):

   ```bash
   # This would be handled by your build system
   tar -czf tobeit69-client-prod-abc123.tar.gz metadata.json packages/ pnpm-lock.yaml
   ```

2. **Deploy to production**:

   ```bash
   ./bin/deploy.js deploy --artifact ./artifacts/tobeit69-client-prod-abc123.tar.gz --verbose
   ```

3. **Verify deployment**:

   ```bash
   curl http://localhost:3002
   pm2 list
   ```

4. **Rollback if needed**:
   ```bash
   ./bin/deploy.js rollback --package client --env prod --verbose
   ```

### Troubleshooting

#### Common Issues

1. **PM2 Service Not Found**

   - The CLI automatically handles missing PM2 services by creating them
   - Ensure PM2 is installed globally: `npm install -g pm2`

2. **Health Check Failures**

   - Verify the application starts correctly
   - Check port conflicts
   - Review application logs: `pm2 logs tobeit69-{package}-{env}`

3. **Permission Issues**

   - Ensure CLI script is executable: `chmod +x bin/deploy.js`
   - Check file permissions on deployment directories

4. **Artifact Issues**
   - Verify artifact contains metadata.json
   - Check artifact structure matches expected format
   - Use `--dry-run` to validate before deployment

#### Debug Mode

Always use `--verbose` flag for detailed troubleshooting information:

```bash
./bin/deploy.js deploy --artifact ./artifact.tar.gz --verbose
./bin/deploy.js rollback --package client --env prod --verbose
```

## Dependencies

- **commander**: CLI argument parsing
- **tar**: Artifact extraction
- **fs-extra**: Enhanced file system operations
- **pm2**: Process management (external dependency)
- **pnpm**: Package management (external dependency)

## License

Part of the TobeIT69 project.
