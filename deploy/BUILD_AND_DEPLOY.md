# Build-and-Deploy System - Complete Plan & Requirements

## User Requirements Summary

### Core Requirements

- **Trunk-based deployment**: 3 branches (main, staging, prod) mapping to respective environments
- **Selective package deployment**: Leverage existing change detection, deploy packages separately
- **Environment file management**: Use SCP for .env file transfers, stored in ~/tobeit69/dotenv/
- **Turborepo pruning**: Use `turbo prune --docker` with efficient artifact creation workflow
- **PM2 process management**: Handle Node.js processes on VPS
- **Version management**: Implement versioning with rollback capabilities
- **Dual execution**: Support both GitHub Actions and local VPS execution

### Key Constraints

- **File containment**: All files must be within ~/tobeit69 directory
- **Workflow separation**: Two separate workflows - build.yml (CI) and deploy.yml (CD)
- **Independent packages**: Each package gets its own pruned workspace and artifacts
- **Dynamic paths**: PM2 config must infer home directory dynamically
- **Artifact-based deployment**: Build once, deploy from pre-built artifacts

---

## Architecture Overview

### Workflow Strategy

**Two-Workflow Approach:**

- **`build.yml`**: Universal CI for all branches + artifact publishing for trunk branches
- **`deploy.yml`**: CD workflow triggered by successful builds + manual redeploy capability

**Workflow Triggers:**

```yaml
# build.yml
on: [push, pull_request, workflow_dispatch]  # All branches

# deploy.yml
on:
  workflow_run:
    workflows: ["Build"]
    branches: [main, staging, prod]           # Trunk branches only
    types: [completed]
  workflow_dispatch: {}                       # Manual redeploy
```

### Branch Strategy

```
main branch    → main environment    (development/testing)
staging branch → staging environment (pre-production)
prod branch    → production environment
```

### File Structure (~/tobeit69)

```
~/tobeit69/
├── repo/                           # Git repository
├── dotenv/                         # Environment files
│   ├── client/
│   │   ├── .env.main
│   │   ├── .env.staging
│   │   └── .env.prod
│   └── server/
│       ├── .env.main
│       ├── .env.staging
│       └── .env.prod
├── deployments/                    # Package-centric deployment management
│   ├── main/
│   │   ├── client/
│   │   │   ├── current -> releases/abc123/2024-01-15-14-30/
│   │   │   └── releases/
│   │   │       ├── abc123/             # Client commit
│   │   │       │   ├── 2024-01-15-14-30/    # Deployment attempt
│   │   │       │   │   ├── packages/client/  # Pruned workspace
│   │   │       │   │   ├── package.json
│   │   │       │   │   ├── pnpm-lock.yaml
│   │   │       │   │   └── .env
│   │   │       │   └── 2024-01-15-16-20/     # Retry attempt
│   │   │       ├── def456/             # Previous client commit
│   │   │       │   └── 2024-01-14-10-15/
│   │   │       └── ghi789/             # Older client commit
│   │   │           └── 2024-01-13-09-30/
│   │   ├── server/
│   │   │   ├── current -> releases/xyz789/2024-01-15-15-45/
│   │   │   └── releases/
│   │   │       ├── xyz789/             # Server commit (different from client!)
│   │   │       │   └── 2024-01-15-15-45/     # Server deployment
│   │   │       ├── uvw456/             # Previous server commit
│   │   │       │   └── 2024-01-14-11-20/
│   │   │       └── rst123/
│   │   │           └── 2024-01-13-08-15/
│   │   ├── shared/
│   │   │   ├── logs/                   # Environment-wide logs
│   │   │   └── uploads/                # Shared assets
│   │   └── pm2.config.js               # Points to package-specific current/
│   ├── staging/ [same structure]
│   └── prod/    [same structure]
├── scripts/                        # Deployment scripts
│   ├── collect-build-artifacts.sh # Collect & package pre-built artifacts
│   ├── deploy/                     # Node.js deployment CLI
│   │   ├── package.json           # Standalone package (not in workspace)
│   │   ├── bin/
│   │   │   └── deploy.js           # CLI entry point
│   │   ├── commands/
│   │   │   ├── deploy.js           # Deploy command
│   │   │   ├── rollback.js         # Rollback command
│   │   │   └── status.js           # Status command
│   │   └── config.js               # Basic configuration
│   └── pm2-ecosystem.template.js
└── versions/                       # Package-specific version tracking
    ├── main-client.json            # Client deployments in main
    ├── main-server.json            # Server deployments in main
    ├── staging-client.json         # Client deployments in staging
    ├── staging-server.json         # Server deployments in staging
    ├── prod-client.json            # Client deployments in prod
    └── prod-server.json            # Server deployments in prod
```

---

## Collect-Build-Artifacts Script

### Script Purpose & Strategy

**Location**: `~/tobeit69/scripts/collect-build-artifacts.sh`

**Purpose**: Collect pre-built artifacts from full workspace and package them for deployment

**Strategy**:

1. Build happens normally in full git workspace (leveraging existing caching, tooling)
2. Script creates pruned workspace structure for deployment
3. Copies build outputs into pruned workspace
4. Packages everything as deployment-ready artifact

### Script Usage Examples

```bash
# Collect client artifacts after build
./scripts/collect-build-artifacts.sh client ./artifacts/

# Collect server artifacts with environment
./scripts/collect-build-artifacts.sh server ./github-artifacts/ --env staging

# With verbose logging
./scripts/collect-build-artifacts.sh client ./dist/ --verbose

# Keep temporary files for debugging
./scripts/collect-build-artifacts.sh client ./artifacts/ --keep-temp

# Dry run to validate setup
./scripts/collect-build-artifacts.sh server ./test/ --dry-run
```

### Script Parameters

```bash
<package>                        # Package to collect (client|server) - required
<output-dir>                     # Output directory - required
--env <main|staging|prod>        # Target environment (optional, auto-detected from branch)
--dry-run                        # Validate setup without collecting
--verbose                        # Detailed logging
--keep-temp                      # Keep temporary files for debugging (default: cleanup)
```

### Script Workflow

1. **Validate Inputs**: Check package exists and has build outputs
2. **Create Pruned Workspace**: Use `turbo prune --scope={package} --docker` to get minimal structure
3. **Copy Build Artifacts**: Copy build outputs (.next/, dist/) into pruned workspace
4. **Add Environment Files**: Copy appropriate .env file for target environment
5. **Create Metadata**: Generate metadata.json with build context
6. **Package Artifact**: Create compressed tarball ready for deployment

---

## Artifact Collection Strategy

### Build-First, Collect-Second Workflow

**Step-by-step process:**

1. **Build in Full Workspace**: Build happens normally in git checkout

   ```bash
   # Existing build.yml workflow continues as-is:
   pnpm install
   pnpm turbo run build --filter={package}
   ```

2. **Create Pruned Structure**: Use `turbo prune` to get minimal workspace

   ```bash
   # collect-build-artifacts.sh creates:
   turbo prune --scope={package} --docker
   # Output: json/ folder (package.json files + pruned pnpm-lock.yaml only)
   ```

3. **Copy Build Artifacts**: Move build outputs into pruned structure

   ```bash
   # For client package:
   cp -r packages/client/.next ./pruned-client/json/packages/client/.next
   cp -r packages/client/public ./pruned-client/json/packages/client/public

   # For server package:
   cp -r packages/server/dist ./pruned-server/json/packages/server/dist
   ```

4. **Add Deployment Files**: Copy environment and metadata

   ```bash
   # Environment file
   cp ~/tobeit69/dotenv/{package}/.env.{environment} ./pruned-{package}/json/.env

   # Metadata for deployment context
   echo '{"package":"client","environment":"staging",...}' > ./pruned-{package}/json/metadata.json
   ```

5. **Package Artifact**: Create deployment-ready tarball
   ```bash
   tar -czf tobeit69-{package}-{environment}-{commit}.tar.gz -C ./pruned-{package}/json .
   ```

**Final artifact contains**:

- Package.json files + pruned pnpm-lock.yaml
- Build outputs only (no source code)
- Environment file and metadata
- Ready for: `pnpm install --prod` + immediate execution

### Artifact Structure

```
tobeit69-{package}-{environment}-{commit}.tar.gz
├── packages/
│   ├── {package}/
│   │   ├── package.json
│   │   ├── .next/          # Build output (client)
│   │   │   ├── static/
│   │   │   ├── server/
│   │   │   └── standalone/ # If using output: 'standalone'
│   │   ├── dist/           # Build output (server)
│   │   └── public/         # Static assets (client)
│   └── api-schema/
│       └── package.json    # Shared dependency
├── package.json            # Root package.json
├── pnpm-lock.yaml         # Pruned lockfile
├── .env.{environment}     # Environment file
└── metadata.json          # Build context, commit info, environment detection
```

### Caching Strategy

Uses existing `build.yml` caching strategies:

- **Node.js cache**: Existing `actions/setup-node` with `cache: "pnpm"`
- **Next.js cache**: Existing `.next/cache` caching in client job
- **No additional caching needed**: Collection script operates on already-built outputs

---

## Workflow Design

### build.yml Modifications

**Minimal additions to existing workflow:**

```yaml
# Add after existing client/server jobs
collect-artifacts:
  runs-on: ubuntu-latest
  needs: [context, client, server]
  if: >
    always() &&
    github.event_name == 'push' &&
    contains(fromJson('["main", "staging", "prod"]'), github.ref_name) &&
    (needs.client.result == 'success' || needs.server.result == 'success')
  steps:
    - name: Checkout for collection script
      uses: actions/checkout@v4
      with:
        sparse-checkout: |
          scripts/collect-build-artifacts.sh
        sparse-checkout-cone-mode: false

    - name: Install pnpm for turbo prune
      uses: pnpm/action-setup@v2
      with:
        version: ${{ env.PNPM_VERSION }}

    - name: Setup SSH Agent
      uses: webfactory/ssh-agent@v0.9.0
      with:
        ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}

    - name: Download client build outputs
      if: needs.client.result == 'success'
      uses: actions/download-artifact@v4
      with:
        name: client-build-${{ github.sha }}
        path: ./

    - name: Download server build outputs
      if: needs.server.result == 'success'
      uses: actions/download-artifact@v4
      with:
        name: server-build-${{ github.sha }}
        path: ./

    - name: Collect client artifacts
      if: needs.client.result == 'success'
      env:
        SSH_USER: ${{ secrets.SSH_USER }}
        SSH_HOST: ${{ secrets.SSH_HOST }}
      run: |
        # Build outputs are now available in workspace
        ./scripts/collect-build-artifacts.sh client ./github-artifacts/ --env "${{ github.ref_name }}" --verbose

    - name: Collect server artifacts
      if: needs.server.result == 'success'
      env:
        SSH_USER: ${{ secrets.SSH_USER }}
        SSH_HOST: ${{ secrets.SSH_HOST }}
      run: |
        # Build outputs are now available in workspace
        ./scripts/collect-build-artifacts.sh server ./github-artifacts/ --env "${{ github.ref_name }}" --verbose

    - name: Upload artifacts
      uses: actions/upload-artifact@v4
      with:
        name: tobeit69-artifacts-${{ github.ref_name }}-${{ github.sha }}
        path: ./github-artifacts/
```

**Integration Requirements**:

1. **Client Job Modification** (packages/client):

   ```yaml
   # Add after "Build Next.js client (SSR check)" step:
   - name: Save client build outputs for collection
     if: github.event_name == 'push' && contains(fromJson('["main", "staging", "prod"]'), github.ref_name)
     uses: actions/upload-artifact@v4
     with:
       name: client-build-${{ github.sha }}
       path: |
         packages/client/.next/
         packages/client/public/
       retention-days: 1
   ```

2. **Server Job Modification** (if server build is enabled):

   ```yaml
   # Add after build step when implemented:
   - name: Save server build outputs for collection
     if: github.event_name == 'push' && contains(fromJson('["main", "staging", "prod"]'), github.ref_name)
     uses: actions/upload-artifact@v4
     with:
       name: server-build-${{ github.sha }}
       path: packages/server/dist/
       retention-days: 1
   ```

3. **Collect-Artifacts Job Downloads**:

   ```yaml
   - name: Download client build outputs
     if: needs.client.result == 'success'
     uses: actions/download-artifact@v4
     with:
       name: client-build-${{ github.sha }}
       path: ./

   - name: Download server build outputs
     if: needs.server.result == 'success'
     uses: actions/download-artifact@v4
     with:
       name: server-build-${{ github.sha }}
       path: ./
   ```

### deploy.yml Structure

```yaml
name: Deploy

on:
  workflow_run:
    workflows: ["Build"]
    branches: [main, staging, prod]
    types: [completed]
  workflow_dispatch:
    inputs:
      force_deploy:
        description: "Force deploy all packages"
        type: boolean
        default: false

jobs:
  check-build-status:
    # Verify build workflow succeeded + parse successful packages

  download-artifacts:
    # Download artifacts from build workflow (environment-specific)

  deploy:
    # Environment-specific deployment using pre-built artifacts
    # No code checkout or rebuilding required
```

### Port Allocation

```
main:    client=3000, server=8080
staging: client=3001, server=8081
prod:    client=3002, server=8082
```

---

## Deployment Process

### build.yml Artifact Collection

1. **Context Analysis**: Reuse existing context and change detection logic
2. **Build Packages**: Type check and build only changed packages (existing jobs)
3. **Save Build Outputs**: Upload build artifacts temporarily for collection job
4. **Collect Artifacts**: Use `collect-build-artifacts.sh` script:
   - Downloads build outputs from previous jobs
   - Creates pruned workspace structure using `turbo prune`
   - Copies build outputs into pruned workspace
   - Adds environment files and metadata
   - Packages as deployment-ready tarball
5. **Upload Artifacts**: Store as GitHub Actions artifacts with environment-specific naming

### deploy.yml Deployment Steps

1. **Verify Build Status**: Check that build workflow completed successfully and artifacts exist
2. **Download Artifacts**: Retrieve pre-collected artifacts from build workflow
   ```yaml
   - name: Download deployment artifacts
     uses: actions/download-artifact@v4
     with:
       name: tobeit69-artifacts-${{ github.ref_name }}-${{ github.sha }}
       path: ./artifacts/
   ```
3. **Deploy Using CLI**: Use Node.js deployment CLI for each collected artifact:

   ```bash
   # Deploy client first (if artifact exists)
   if [ -f "./artifacts/tobeit69-client-${ENV}-${COMMIT}.tar.gz" ]; then
     ./scripts/deploy/bin/deploy.js deploy --artifact ./artifacts/tobeit69-client-${ENV}-${COMMIT}.tar.gz --verbose
   fi

   # Deploy server second (if artifact exists)
   if [ -f "./artifacts/tobeit69-server-${ENV}-${COMMIT}.tar.gz" ]; then
     ./scripts/deploy/bin/deploy.js deploy --artifact ./artifacts/tobeit69-server-${ENV}-${COMMIT}.tar.gz --verbose
   fi
   ```

4. **Validation**: Verify all deployments completed successfully with health checks

### Artifact Metadata Structure

```json
// metadata.json (included in each artifact)
{
  "environment": "staging",
  "package": "client",
  "commit": "abc123def456",
  "timestamp": "2024-01-15T14:30:00Z",
  "buildInfo": {
    "nodeVersion": "22",
    "pnpmVersion": "10",
    "buildTime": "2024-01-15T14:28:30Z"
  }
}
```

### Version Tracking Structure

```json
// ~/tobeit69/versions/staging.json
{
  "current": "2024-01-15-14-30-abc123",
  "deployments": [
    {
      "version": "2024-01-15-14-30-abc123",
      "commit": "abc123def456",
      "timestamp": "2024-01-15T14:30:00Z",
      "packages": ["client"],
      "status": "active"
    },
    {
      "version": "2024-01-14-16-45-def456",
      "commit": "def456abc123",
      "timestamp": "2024-01-14T16:45:00Z",
      "packages": ["server"],
      "status": "inactive"
    }
  ]
}
```

---

## Local Execution Scripts

### Collect-Build-Artifacts Script Usage

```bash
# ~/tobeit69/scripts/collect-build-artifacts.sh

# After building client locally
pnpm turbo run build --filter=client
./scripts/collect-build-artifacts.sh client ./artifacts/ --env main

# After building server locally
pnpm turbo run build --filter=server
./scripts/collect-build-artifacts.sh server ./dist/ --env prod --verbose

# Keep temporary files for debugging
./scripts/collect-build-artifacts.sh server ./artifacts/ --keep-temp

# For GitHub Actions (build outputs already available)
./scripts/collect-build-artifacts.sh client ./github-artifacts/ --env staging
```

### Node.js Deploy CLI Usage

```bash
# ~/tobeit69/scripts/deploy/bin/deploy.js

# Deploy from artifact (environment auto-detected from metadata)
./scripts/deploy/bin/deploy.js deploy --artifact ./tobeit69-client-main-abc123.tar.gz

# Deploy with verbose logging
./scripts/deploy/bin/deploy.js deploy --artifact ./artifacts/*.tar.gz --verbose

# Dry-run deployment validation
./scripts/deploy/bin/deploy.js deploy --artifact ./server.tar.gz --dry-run

# Package-specific rollback
./scripts/deploy/bin/deploy.js rollback --package client --env staging
./scripts/deploy/bin/deploy.js rollback --package server --env prod --commit abc123

# Rollback to specific attempt within commit
./scripts/deploy/bin/deploy.js rollback --package client --env main --commit abc123 --attempt 2024-01-15-14-30

# Check deployment status
./scripts/deploy/bin/deploy.js status --env staging
./scripts/deploy/bin/deploy.js status --package server --env prod
./scripts/deploy/bin/deploy.js status --all
```

### Node.js CLI Key Features

**Package-Independent Operations**: Each package (client, server) can be deployed, rolled back, and managed independently with different commits.

**Simplified Command Interface**: Single CLI with three commands (deploy, rollback, status) using commander.js for argument parsing.

**Shared Utilities**: Common functions for path resolution, logging, file operations, and health checks to reduce code duplication.

**Environment Auto-Detection**: Deployment environment automatically detected from artifact metadata, no manual specification needed.

**Atomic Operations**: Symlink-based deployment with automatic rollback on failure and comprehensive health checking.

### Legacy Deploy Script Usage (Bash)

```bash
# Deploy with explicit validation
./deploy.js deploy --artifact ./artifacts/tobeit69-server-prod-def456.tar.gz --verbose

# Rollback to previous commit
./deploy.js rollback --package server --commit def456 --env staging

# Rollback to specific attempt within current commit
./deploy.js rollback --package client --commit abc123 --attempt 2024-01-15-14-30 --env staging

# Check deployment status
./deploy.js status --env prod

# Dry-run deployment validation
./deploy.js deploy --artifact ./tobeit69-client-staging-xyz789.tar.gz --dry-run
```

### Node.js CLI Architecture

**Command Parameters:**

```bash
# Deploy command
deploy --artifact <path>         # Path to single-package artifact (required)
       --dry-run                 # Validate without deploying
       --verbose                 # Detailed logging

# Rollback command
rollback --package <name>        # Package name: client|server (required)
         --env <name>            # Environment: main|staging|prod (required)
         --commit <hash>         # Git commit hash (optional)
         --attempt <timestamp>   # Specific deployment attempt (optional)
         --verbose               # Detailed logging

# Status command
status --env <name>              # Environment to check (optional)
       --package <name>          # Package to check (optional)
       --all                     # Show all environments
```

**Core Workflow (Deploy Action):**

1. **Extract & Validate Artifact**

   - Extract pre-collected artifact to temporary location
   - Read `metadata.json` to auto-detect environment and package
   - Validate artifact structure (pruned workspace + build outputs)

2. **Prepare Release Directory**

   - Create `~/tobeit69/deployments/{env}/{package}/releases/{commit}/{timestamp}/`
   - Extract artifact contents directly to release directory
   - Install production dependencies: `pnpm install --prod --frozen-lockfile`
   - Verify build outputs are present (.next/, dist/, etc.)

3. **Isolated Health Check**

   - Find random available port (9000-9999 range)
   - Start server on random port without PM2
   - Wait for startup (configurable timeout, default 30s)
   - Send health check request to verify response
   - Kill test server

4. **Atomic Deployment**

   - Update package symlink: `~/tobeit69/deployments/{env}/{package}/current -> releases/{commit}/{timestamp}/`
   - Reload PM2 service: `pm2 reload tobeit69-{package}-{env}`
   - Verify PM2 service is healthy
   - Run final health check on production ports

5. **Success/Rollback Logic**
   - If all checks pass: deployment success, cleanup old commits and attempts
   - If any step fails: automatic rollback to previous commit's active attempt
   - Update version metadata files

**Artifact Requirements:**

- ✅ **Single-package only**: Each artifact contains exactly one package (client OR server)
- ✅ **Environment metadata**: Environment auto-detected from `metadata.json`
- ✅ **Pre-built artifacts**: No building during deployment, only artifact extraction and installation
- ✅ **CI deployment order**: When both packages change, client deploys first

**Logging & Cleanup:**

- ✅ **Service logs**: Handled by PM2, stored in shared environment folder
- ✅ **Deployment logs**: Stored per-attempt, follows cleanup policy
- ✅ **Commit-based cleanup**: Keep 5 recent Git commits (entire commit directories)
- ✅ **Attempt cleanup**: Within each commit, keep 2 most recent attempts (1 success + 1 failure max)
- ✅ **Failed deployments**: Cleaned with attempt policy, logs retained for debugging

**Unified Script Capabilities:**

- **Artifact-driven deployment**: Accept pre-built artifacts from any source
- **Environment auto-detection**: Infer target environment from artifact metadata
- **Action types**: deploy, rollback, status with comprehensive validation
- **Flexible execution**: Local development, VPS direct deployment, CI/CD integration
- **Safety features**: Isolated health checks, atomic deployment, automatic rollback
- **Extensibility**: Designed for future pre/post deployment hooks

---

## PM2 Configuration Strategy

### Configuration Structure

**One config file per environment:**

```
~/tobeit69/deployments/
├── main/
│   ├── pm2.config.js          # Static config for main environment
│   ├── current -> releases/... # Symlink points to active release
│   └── releases/...
├── staging/
│   ├── pm2.config.js          # Static config for staging environment
│   └── ...
└── prod/
    ├── pm2.config.js          # Static config for prod environment
    └── ...
```

### PM2 Config Template

```javascript
// ~/tobeit69/deployments/{environment}/pm2.config.js
const path = require("path");
const deploymentDir = __dirname;
const currentDir = path.join(deploymentDir, "current");

module.exports = {
  apps: [
    {
      name: "tobeit69-client-{environment}",
      cwd: path.join(currentDir, "packages/client"),
      script: "npm",
      args: "start",
      instances: 1,
      exec_mode: "fork",
      env_file: path.join(currentDir, ".env"),
      env: {
        NODE_ENV: "production",
        PORT: { client_port }, // 3000=main, 3001=staging, 3002=prod
      },
    },
    {
      name: "tobeit69-server-{environment}",
      cwd: path.join(currentDir, "packages/server"),
      script: "npm",
      args: "start",
      instances: { server_instances }, // prod=2, staging=1, main=1
      exec_mode: { exec_mode }, // prod='cluster', others='fork'
      env_file: path.join(currentDir, ".env"),
      env: {
        NODE_ENV: "production",
        PORT: { server_port }, // 8080=main, 8081=staging, 8082=prod
      },
    },
  ],
};
```

### Instance Allocation (Single Server)

**Resource-aware allocation for shared server:**

- **Production**: 2 server instances (cluster mode) - highest priority
- **Staging**: 1 server instance (cluster mode) - testing load balancing
- **Main**: 1 server instance (fork mode) - development simplicity
- **All environments**: 1 client instance (fork mode) - Next.js doesn't benefit from clustering

### Environment Variable Management

**Per-deployment isolation:**

```bash
# Each deployment gets its own environment file copy
~/tobeit69/deployments/{env}/releases/{timestamp}/.env

# Source: ~/tobeit69/dotenv/{package}/.env.{environment}
# Copied during deployment for self-contained releases
```

**Environment update workflow:**

1. Update source files in `~/tobeit69/dotenv/`
2. Redeploy same artifact to apply new environment variables
3. New release created with updated environment snapshot

### Service Management

**Naming convention:** `tobeit69-{package}-{environment}`

- Examples: `tobeit69-server-prod`, `tobeit69-client-staging`

**Selective operations:**

```bash
# Deploy script reloads only the affected service
pm2 reload tobeit69-client-staging

# Health check specific service
pm2 describe tobeit69-server-prod

# Environment-specific operations
pm2 list | grep staging
```

**Integration with Node.js CLI:**

```javascript
// Selective service reload in deployment (commands/deploy.js)
async function reloadPM2Service(metadata) {
  const packageName = metadata.package;
  const envName = metadata.environment;
  const serviceName = `tobeit69-${packageName}-${envName}`;

  await execCommand(`pm2 reload "${serviceName}"`);
  await execCommand(`pm2 describe "${serviceName}" | grep "status.*online"`);
}
```

### Key Benefits

- **Static configs, dynamic paths**: PM2 config references `current/` symlink
- **Resource efficiency**: Appropriate instance allocation for shared server
- **Operational simplicity**: One config per environment, selective service management
- **Deployment safety**: Self-contained releases with environment isolation
- **Independent packages**: Client and server services managed separately

---

## Environment Variables

### GitHub Secrets

```bash
SSH_PRIVATE_KEY         # SSH key for VPS access
SSH_USER               # VPS username
SSH_HOST               # VPS hostname
DEPLOYMENT_BASE_PATH   # ~/tobeit69 (configurable)

# Environment-specific health check URLs
MAIN_CLIENT_URL        # http://localhost:3000
STAGING_CLIENT_URL     # http://localhost:3001
PROD_CLIENT_URL        # http://localhost:3002
MAIN_SERVER_URL        # http://localhost:8080/health
STAGING_SERVER_URL     # http://localhost:8081/health
PROD_SERVER_URL        # http://localhost:8082/health
```

---

## Key Features

### Clean Separation of Concerns

- ✅ **build.yml**: Universal CI for all branches + artifact publishing for trunk branches
- ✅ **deploy.yml**: Pure CD workflow consuming pre-built artifacts
- ✅ No environment override confusion - deploy.yml scoped to current environment only
- ✅ Manual redeploy via `workflow_dispatch` without rebuilding

### Efficient Artifact-Based Deployment

- ✅ Build once in optimized Turborepo pruned workspace
- ✅ Deploy lightweight artifacts (package.json + build outputs only)
- ✅ Fast deployment: `pnpm install --prod` + immediate execution
- ✅ Enhanced caching with pruned dependency lockfiles

### Selective & Intelligent Deployment

- ✅ Reuse existing sophisticated change detection logic
- ✅ Only deploy packages that have changes and built successfully
- ✅ Independent artifacts for each package and environment
- ✅ Workflow dependency ensures deployments only happen after successful builds

### Zero-Downtime Deployment

- ✅ Atomic symlink switching
- ✅ PM2 graceful restart
- ✅ Health check validation before completion
- ✅ Rollback capability via version management

### Production-Ready Reliability

- ✅ Version management with timestamped releases
- ✅ Keep last 5 deployments for quick rollback
- ✅ Environment file management via SCP
- ✅ Comprehensive health checks and error handling
- ✅ Automatic cleanup of old deployments

---

This refined plan provides a production-ready deployment system with clean separation between CI and CD, efficient artifact-based deployment, and robust reliability features while maximizing the benefits of Turborepo's pruning capabilities.
