# Collect Build Artifacts Action

A composite GitHub Action that collects pre-built artifacts from the TobeIT69 workspace using the `collect-build-artifacts.sh` script.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `package` | Package name (`client` or `server`) | Yes | - |
| `monorepo-root` | Path to monorepo root directory (optional, auto-detected if not provided) | No | Auto-detected |
| `use-cdn` | Enable CDN mode (exclude static assets, generate manifest) | No | `false` |
| `debug` | Enable debug output | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `artifact-path` | Full path to the generated artifact file |
| `artifact-name` | Name of the generated artifact file |

## Usage

```yaml
steps:
  - name: Checkout code
    uses: actions/checkout@v4

  - name: Setup Node.js
    uses: actions/setup-node@v4
    with:
      node-version: '20'

  - name: Install dependencies and build
    run: |
      corepack enable
      pnpm install
      pnpm build

  - name: Collect client artifacts
    id: collect-client
    uses: ./.github/actions/collect-build-artifacts
    with:
      package: client
      debug: true

  - name: Upload artifacts
    uses: actions/upload-artifact@v4
    with:
      name: ${{ steps.collect-client.outputs.artifact-name }}
      path: ${{ steps.collect-client.outputs.artifact-path }}

  - name: Use artifact in next step
    run: |
      echo "Artifact created at: ${{ steps.collect-client.outputs.artifact-path }}"
      echo "Artifact name: ${{ steps.collect-client.outputs.artifact-name }}"
```

### CDN Mode Example

```yaml
steps:
  - name: Collect CDN-optimized client artifacts
    id: collect-client-cdn
    uses: ./.github/actions/collect-build-artifacts
    with:
      package: client
      use-cdn: true
      debug: true

  - name: Upload CDN artifacts
    uses: actions/upload-artifact@v4
    with:
      name: ${{ steps.collect-client-cdn.outputs.artifact-name }}
      path: ${{ steps.collect-client-cdn.outputs.artifact-path }}
```

### Custom Monorepo Root Example

```yaml
steps:
  - name: Collect artifacts with custom root
    id: collect-custom
    uses: ./.github/actions/collect-build-artifacts
    with:
      package: server
      monorepo-root: /path/to/custom/monorepo
      debug: true
```

## Features

- Creates pruned workspace artifacts in `$RUNNER_TEMP/artifacts`
- Auto-detects environment from git branch and monorepo root
- Supports CDN mode for optimized static asset deployment
- Generates compressed tarballs with naming:
  - Standard: `tobeit69-{package}-{environment}-{commit-hash}.tar.gz`
  - CDN mode: `tobeit69-{package}-{environment}-{commit-hash}-cdn.tar.gz`
- Returns both full path and filename for flexible usage
- Supports debug output for troubleshooting
- CDN mode generates asset manifests for reference-based cleanup

## Requirements

- The `collect-build-artifacts.sh` script must be present in the `scripts/` directory
- Packages must be built before running this action
- Git repository must be checked out