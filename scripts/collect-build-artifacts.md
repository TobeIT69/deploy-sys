# Collect Build Artifacts Script

This document provides detailed documentation for the `collect-build-artifacts.sh` script, which is responsible for collecting pre-built artifacts from the full workspace and packaging them for deployment.

## Overview

The `collect-build-artifacts.sh` script creates pruned workspace artifacts that contain only what's necessary for deployment:

- Package.json files with pruned pnpm-lock.yaml
- Build outputs only (no source code)
- Environment files and metadata
- Ready for immediate `pnpm install --prod` + execution

## Purpose and Strategy

The script follows a two-phase deployment strategy:

1. **Build Phase**: Normal build happens in the full git workspace
2. **Collection Phase**: Script creates a pruned workspace structure containing only deployment artifacts

This approach separates build complexity from deployment simplicity, ensuring deployments are fast and contain minimal files.

## Usage

### Basic Syntax

```bash
./collect-build-artifacts.sh <package> <output-dir> [options]
```

### Arguments

| Argument       | Description                               | Required |
| -------------- | ----------------------------------------- | -------- |
| `<package>`    | Package to collect (`client` or `server`) | Yes      |
| `<output-dir>` | Output directory for artifacts            | Yes      |

### Options

| Option                        | Description                                    | Default       |
| ----------------------------- | ---------------------------------------------- | ------------- |
| `--root <monorepo-root>`      | Custom monorepo root directory                | Auto-detected |
| `--env <main\|staging\|prod>` | Target environment (auto-detected from branch) | Auto-detected |
| `--use-cdn`                   | Enable CDN mode (exclude static assets, generate manifest) | false |
| `--dry-run`                   | Validate setup without collecting              | false         |
| `--verbose`                   | Detailed logging                               | false         |
| `--keep-temp`                 | Keep temporary files for debugging             | false         |
| `-h, --help`                  | Show help message                              | -             |

### Examples

```bash
# Collect client artifacts after build
./collect-build-artifacts.sh client ./artifacts/

# Collect server artifacts with specific environment
./collect-build-artifacts.sh server ./github-artifacts/ --env staging

# Dry run to validate setup
./collect-build-artifacts.sh server ./test/ --dry-run

# Verbose logging with temp file preservation
./collect-build-artifacts.sh client ./artifacts/ --verbose --keep-temp

# CDN mode for optimized static asset deployment
./collect-build-artifacts.sh client ./artifacts/ --use-cdn

# CDN mode with custom root and verbose logging
./collect-build-artifacts.sh client ./artifacts/ --root /path/to/monorepo --use-cdn --verbose
```

## Environment Detection

The script automatically detects the target environment using the following priority:

1. **Explicit `--env` parameter** (highest priority)
2. **Git branch name** detection:
   - `main` branch → `main` environment
   - `staging` branch → `staging` environment
   - `prod` branch → `prod` environment
3. **Default fallback** → `main` environment

## Implementation Details

### Prerequisites Validation

The script validates the following before proceeding:

#### Dependencies

- `pnpm` with `turbo` support
- `jq` for JSON processing
- `tar` for archive creation
- `git` for commit hash extraction (optional)

#### Package Structure

- Package directory exists: `packages/{package}/`
- Valid `package.json` in package directory
- Build outputs present:
  - **Client**: `.next` directory (Next.js build)
  - **Server**: `dist` directory (compiled TypeScript)

### Core Workflow

#### 1. Pruned Workspace Creation

```bash
# Uses turbo prune to create minimal workspace
pnpm turbo prune {package} --docker --out-dir=pruned-{package}
```

Creates a Docker-optimized workspace containing:

- Root package.json and pruned pnpm-lock.yaml
- Package-specific package.json files
- Workspace structure without source code

#### 2. Build Artifacts Copy

**For Client Package:**

- `.next/` directory (Next.js build output)
  - **Standard mode**: Includes all files including `.next/static/`
  - **CDN mode** (`--use-cdn`): Excludes `.next/static/` directory, creates empty placeholder
- `public/` directory (static assets, if present)

**For Server Package:**

- `dist/` directory (compiled TypeScript)
- Not affected by CDN mode

#### 3. Environment Files

The script searches for environment files in this order:

1. **Structured dotenv**: `~/tobeit69/dotenv/{package}/.env.{environment}`
2. **Package-level**: `packages/{package}/.env.{environment}`
3. **Generic fallback**: `packages/{package}/.env`

#### 4. Metadata Generation

Creates `metadata.json` with deployment information:

**Standard Mode:**
```json
{
  "environment": "staging",
  "package": "client",
  "commit": "abc123def456...",
  "timestamp": "2024-01-15T10:30:00Z",
  "buildInfo": {
    "nodeVersion": "20.10.0",
    "pnpmVersion": "9.1.0",
    "buildTime": "2024-01-15T10:30:00Z"
  },
  "cdnAssets": {}
}
```

**CDN Mode (`--use-cdn`):**
```json
{
  "environment": "staging",
  "package": "client",
  "commit": "abc123def456...",
  "timestamp": "2024-01-15T10:30:00Z",
  "buildInfo": {
    "nodeVersion": "20.10.0",
    "pnpmVersion": "9.1.0",
    "buildTime": "2024-01-15T10:30:00Z"
  },
  "cdnAssets": {
    "packages/client/.next/static/chunks": ["app-123.js", "framework-456.js"],
    "packages/client/.next/static/css": ["app-789.css"]
  }
}
```

#### 5. Artifact Packaging

Creates compressed tarball with naming convention:

**Standard Mode:**
```
tobeit69-{package}-{environment}-{commit-hash}.tar.gz
```

**CDN Mode:**
```
tobeit69-{package}-{environment}-{commit-hash}-cdn.tar.gz
```

Examples:

- `tobeit69-client-staging-abc123d.tar.gz` (standard)
- `tobeit69-client-staging-abc123d-cdn.tar.gz` (CDN mode)
- `tobeit69-server-prod-def456a.tar.gz` (server packages unaffected by CDN mode)

### Directory Structure

The script creates the following temporary structure:

```
{output-dir}/
├── .temp-prune-{pid}/
│   └── pruned-{package}/
│       └── json/                    # Pruned workspace root
│           ├── package.json         # Root package.json
│           ├── pnpm-lock.yaml      # Pruned lockfile
│           ├── packages/
│           │   └── {package}/
│           │       ├── package.json # Package-specific package.json
│           │       ├── .next/       # (client only)
│           │       ├── public/      # (client only, if exists)
│           │       └── dist/        # (server only)
│           ├── .env                 # Environment file
│           └── metadata.json        # Deployment metadata
└── tobeit69-{package}-{env}-{commit}.tar.gz  # Final artifact
```

## Error Handling and Logging

### Logging Levels

- **Standard**: Basic operation status and results
- **Verbose** (`--verbose`): Detailed step-by-step information
- **Error**: Critical issues that stop execution

### Common Error Scenarios

| Error                 | Cause                            | Solution                                      |
| --------------------- | -------------------------------- | --------------------------------------------- |
| Missing build outputs | Build not run before collection  | Run `pnpm turbo run build --filter={package}` |
| Invalid package       | Typo or unsupported package name | Use `client` or `server`                      |
| Missing dependencies  | Required tools not installed     | Install pnpm, jq, tar                         |
| Permission denied     | Insufficient write permissions   | Check output directory permissions            |

### Cleanup and Recovery

- **Automatic cleanup**: Temporary directories removed on success
- **Emergency cleanup**: Trap handlers clean up on script interruption
- **Debug mode**: `--keep-temp` preserves temporary files for troubleshooting

## Integration with CI/CD

### GitHub Actions Example

```yaml
- name: Collect Client Artifacts
  run: |
    ./scripts/collect-build-artifacts.sh client ./artifacts/ --env staging

- name: Upload Artifacts
  uses: actions/upload-artifact@v4
  with:
    name: client-artifacts
    path: ./artifacts/*.tar.gz
```

### Local Development

```bash
# Build and collect in one command
pnpm turbo run build --filter=client && \
./scripts/collect-build-artifacts.sh client ./artifacts/ --verbose
```

## Output Artifacts

### Artifact Contents

Each generated `.tar.gz` contains:

- **Minimal workspace** ready for `pnpm install --prod`
- **Build outputs** for immediate execution
- **Environment configuration** for target deployment
- **Metadata** for deployment tracking and debugging

### Deployment Usage

```bash
# Extract artifact
tar -xzf tobeit69-client-staging-abc123d.tar.gz

# Install production dependencies
pnpm install --prod

# Start application (example for client)
pnpm start
```

## Troubleshooting

### Dry Run Mode

Use `--dry-run` to validate setup without creating artifacts:

```bash
./collect-build-artifacts.sh client ./test/ --dry-run --verbose
```

### Debug Mode

Use `--keep-temp --verbose` to preserve temporary files and see detailed logs:

```bash
./collect-build-artifacts.sh client ./artifacts/ --keep-temp --verbose
```

### Common Issues

1. **"No build outputs found"**: Run build command first
2. **"Turbo prune failed"**: Check pnpm and turbo installation
3. **"Environment file not found"**: Verify environment file paths
4. **Large artifact size**: Review included files, may indicate source code inclusion

## Performance Considerations

- **Pruned workspace**: Significantly reduces artifact size vs. full workspace
- **Parallel operations**: Build and collection can run independently
- **Cached dependencies**: Lockfile pruning enables faster `pnpm install`
- **Compression**: gzip compression reduces transfer and storage costs

This script is designed to be a robust, production-ready solution for creating deployment artifacts that are both minimal and complete.
