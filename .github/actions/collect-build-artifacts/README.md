# Collect Build Artifacts Action

A composite GitHub Action that collects pre-built artifacts from the TobeIT69 workspace using the `collect-build-artifacts.sh` script.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `package` | Package name (`client` or `server`) | Yes | - |
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

## Features

- Creates pruned workspace artifacts in `$RUNNER_TEMP/artifacts`
- Auto-detects environment from git branch
- Generates compressed tarballs with naming: `tobeit69-{package}-{environment}-{commit-hash}.tar.gz`
- Returns both full path and filename for flexible usage
- Supports debug output for troubleshooting

## Requirements

- The `collect-build-artifacts.sh` script must be present in the `scripts/` directory
- Packages must be built before running this action
- Git repository must be checked out