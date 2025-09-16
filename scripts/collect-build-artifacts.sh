#!/bin/bash

# collect-build-artifacts.sh
# Purpose: Collect pre-built artifacts from full workspace and package them for deployment
# Strategy: Build happens normally in full git workspace, script creates pruned workspace structure for deployment

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOME_DIR="$(dirname "$REPO_ROOT")"

# Default values
PACKAGE=""
OUTPUT_DIR=""
CUSTOM_ROOT=""
ENVIRONMENT=""
DRY_RUN=false
VERBOSE=false
KEEP_TEMP=false
USE_CDN=false

# Logging functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

verbose_log() {
    if [ "$VERBOSE" = true ]; then
        log "VERBOSE: $*"
    fi
}

error() {
    log "ERROR: $*" >&2
    exit 1
}

# Usage function
usage() {
    cat << EOF
Usage: $0 <package> <output-dir> [options]

Collect pre-built artifacts from monorepo package and package them for deployment.

Arguments:
  <package>                        Package name (client|server) - required
  <output-dir>                     Output directory for artifacts - required

Options:
  --root <monorepo-root>           Custom monorepo root directory (default: auto-detect)
  --env <main|staging|prod>        Target environment (optional, auto-detected from branch)
  --use-cdn                        Enable CDN mode (exclude static assets, generate manifest)
  --dry-run                        Validate setup without collecting
  --verbose                        Detailed logging
  --keep-temp                      Keep temporary files for debugging (default: false)
  -h, --help                       Show this help message

Examples:
  # Collect client artifacts (auto-detect monorepo root)
  ./collect-build-artifacts.sh client ./artifacts/

  # Collect server artifacts with custom root
  ./collect-build-artifacts.sh server ./github-artifacts/ --root /path/to/monorepo

  # With environment and verbose logging
  ./collect-build-artifacts.sh client ./dist/ --env staging --verbose

  # Keep temporary files for debugging
  ./collect-build-artifacts.sh client ./artifacts/ --keep-temp

  # Dry run to validate setup
  ./collect-build-artifacts.sh server ./test/ --dry-run
EOF
}

# Parse command line arguments
parse_args() {
    if [ $# -lt 2 ]; then
        usage
        exit 1
    fi

    PACKAGE="$1"
    OUTPUT_DIR="$2"
    shift 2

    while [ $# -gt 0 ]; do
        case "$1" in
            --root)
                if [ $# -lt 2 ]; then
                    error "Option --root requires an argument"
                fi
                CUSTOM_ROOT="$2"
                shift 2
                ;;
            --env)
                if [ $# -lt 2 ]; then
                    error "Option --env requires an argument"
                fi
                ENVIRONMENT="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --keep-temp)
                KEEP_TEMP=true
                shift
                ;;
            --use-cdn)
                USE_CDN=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                ;;
        esac
    done
}

# Detect or set monorepo root directory
detect_monorepo_root() {
    if [ -n "$CUSTOM_ROOT" ]; then
        # Use custom root if provided
        if [ ! -d "$CUSTOM_ROOT" ]; then
            error "Custom root directory does not exist: $CUSTOM_ROOT"
        fi
        REPO_ROOT="$(cd "$CUSTOM_ROOT" && pwd)"
        verbose_log "Using custom monorepo root: $REPO_ROOT"
    else
        # Auto-detect monorepo root
        local current_dir="$SCRIPT_DIR"
        local found_root=""

        # Look for monorepo indicators going up the directory tree
        while [ "$current_dir" != "/" ]; do
            if [ -f "$current_dir/pnpm-workspace.yaml" ] ||
               [ -f "$current_dir/turbo.json" ] ||
               ([ -f "$current_dir/package.json" ] && jq -e '.workspaces' "$current_dir/package.json" >/dev/null 2>&1); then
                found_root="$current_dir"
                break
            fi
            current_dir="$(dirname "$current_dir")"
        done

        if [ -n "$found_root" ]; then
            REPO_ROOT="$found_root"
            verbose_log "Auto-detected monorepo root: $REPO_ROOT"
        else
            # Fallback to script's parent directory
            REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
            verbose_log "Could not auto-detect monorepo root, using fallback: $REPO_ROOT"
        fi
    fi

    # Update HOME_DIR based on detected/set REPO_ROOT
    HOME_DIR="$(dirname "$REPO_ROOT")"
}

# Validate package parameter
validate_package() {
    case "$PACKAGE" in
        client|server)
            verbose_log "Package '$PACKAGE' is valid"
            ;;
        *)
            error "Invalid package '$PACKAGE'. Must be 'client' or 'server'"
            ;;
    esac
}

# Auto-detect environment from git branch
detect_environment() {
    if [ -n "$ENVIRONMENT" ]; then
        verbose_log "Environment explicitly set to: $ENVIRONMENT"
        return
    fi

    if [ -d "$REPO_ROOT/.git" ]; then
        local branch_name
        branch_name=$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

        case "$branch_name" in
            main|staging|prod)
                ENVIRONMENT="$branch_name"
                log "Auto-detected environment from git branch: $ENVIRONMENT"
                ;;
            *)
                ENVIRONMENT="main"
                log "Could not detect environment from branch '$branch_name', defaulting to: $ENVIRONMENT"
                ;;
        esac
    else
        ENVIRONMENT="main"
        log "Not in a git repository, defaulting to environment: $ENVIRONMENT"
    fi
}

# Validate environment parameter
validate_environment() {
    case "$ENVIRONMENT" in
        main|staging|prod)
            verbose_log "Environment '$ENVIRONMENT' is valid"
            ;;
        *)
            error "Invalid environment '$ENVIRONMENT'. Must be 'main', 'staging', or 'prod'"
            ;;
    esac
}

# Check if required tools are available
check_dependencies() {
    local missing_deps=()
    local current_dir="$(pwd)"

    # Change to repo root for dependency checks
    cd "$REPO_ROOT"

    if ! command -v pnpm >/dev/null 2>&1; then
        missing_deps+=("pnpm")
    fi

    # Check if turbo is available through pnpm
    if ! command -v pnpm >/dev/null 2>&1 || ! pnpm turbo --version >/dev/null 2>&1; then
        missing_deps+=("turbo (via pnpm)")
    fi

    if ! command -v jq >/dev/null 2>&1; then
        missing_deps+=("jq")
    fi

    if ! command -v tar >/dev/null 2>&1; then
        missing_deps+=("tar")
    fi

    # Return to original directory
    cd "$current_dir"

    if [ ${#missing_deps[@]} -gt 0 ]; then
        error "Missing required dependencies: ${missing_deps[*]}"
    fi

    verbose_log "All required dependencies are available"
}

# Validate package exists and has expected structure
validate_package_structure() {
    local package_dir="$REPO_ROOT/packages/$PACKAGE"

    if [ ! -d "$package_dir" ]; then
        error "Package directory does not exist: $package_dir"
    fi

    if [ ! -f "$package_dir/package.json" ]; then
        error "Package.json not found in: $package_dir"
    fi

    verbose_log "Package structure is valid: $package_dir"
}

# Check if build outputs exist
validate_build_outputs() {
    local package_dir="$REPO_ROOT/packages/$PACKAGE"
    local build_outputs_exist=false

    case "$PACKAGE" in
        client)
            if [ -d "$package_dir/.next" ]; then
                verbose_log "Found Next.js build outputs: $package_dir/.next"
                build_outputs_exist=true
            fi
            ;;
        server)
            if [ -d "$package_dir/dist" ]; then
                verbose_log "Found server build outputs: $package_dir/dist"
                build_outputs_exist=true
            fi
            ;;
    esac

    if [ "$build_outputs_exist" = false ]; then
        error "No build outputs found for package '$PACKAGE' in $package_dir. Please run 'pnpm turbo run build --filter=$PACKAGE' first."
    fi

    verbose_log "Build outputs validation passed"
}

# Validate CDN environment when CDN mode is enabled
validate_cdn_environment() {
    if [ "$USE_CDN" != true ]; then
        verbose_log "CDN mode disabled, skipping CDN environment validation"
        return
    fi

    verbose_log "Validating CDN environment variables"

    if [ -z "$NEXT_CDN_ASSETS_URL" ]; then
        error "NEXT_CDN_ASSETS_URL environment variable is required when using --use-cdn flag.
This URL should match the assetPrefix configured in your Next.js build process.
Example: export NEXT_CDN_ASSETS_URL='https://cdn.example.com/assets'"
    fi

    # Basic URL validation
    case "$NEXT_CDN_ASSETS_URL" in
        http://*|https://*)
            verbose_log "CDN assets URL is valid: $NEXT_CDN_ASSETS_URL"
            ;;
        *)
            error "NEXT_CDN_ASSETS_URL must be a valid HTTP or HTTPS URL. Got: $NEXT_CDN_ASSETS_URL"
            ;;
    esac

    verbose_log "CDN environment validation passed"
}

# Create output directory
prepare_output_directory() {
    if [ "$DRY_RUN" = true ]; then
        verbose_log "DRY RUN: Would create output directory: $OUTPUT_DIR"
        return
    fi

    mkdir -p "$OUTPUT_DIR"
    OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)" # Get absolute path
    verbose_log "Output directory prepared: $OUTPUT_DIR"
}

# Create pruned workspace using turbo prune
create_pruned_workspace() {
    local temp_dir="$OUTPUT_DIR/.temp-prune-$$"
    local prune_dir="$temp_dir/pruned-$PACKAGE"

    if [ "$DRY_RUN" = true ]; then
        verbose_log "DRY RUN: Would create pruned workspace for $PACKAGE"
        return
    fi

    verbose_log "Creating pruned workspace for package: $PACKAGE"

    mkdir -p "$temp_dir"
    cd "$temp_dir"

    # Use turbo prune to create minimal workspace structure
    verbose_log "Running: pnpm turbo prune $PACKAGE --docker --out-dir=pruned-$PACKAGE"
    cd "$REPO_ROOT"
    pnpm turbo prune "$PACKAGE" --docker --out-dir="$temp_dir/pruned-$PACKAGE" > /dev/null

    if [ ! -d "$prune_dir/json" ]; then
        error "Turbo prune failed to create expected directory structure"
    fi

    verbose_log "Pruned workspace created successfully: $prune_dir/json"
    echo "$prune_dir/json" # Return the path for use by other functions
}

# Generate CDN asset manifest
generate_cdn_asset_manifest() {
    local package_dir="$REPO_ROOT/packages/$PACKAGE"

    if [ "$USE_CDN" != true ]; then
        echo "{}"
        return
    fi

    verbose_log "Generating CDN asset manifest for package: $PACKAGE"

    case "$PACKAGE" in
        client)
            # Find all static assets in .next/static
            local static_dir="$package_dir/.next/static"
            if [ -d "$static_dir" ]; then
                # Use find and jq to generate the manifest
                local temp_files=$(mktemp)

                # Find all files and group by directory
                find "$static_dir" -type f | while read -r file; do
                    local relative_path="${file#$static_dir/}"
                    local dir_path=$(dirname "$relative_path")
                    local file_name=$(basename "$relative_path")
                    echo "packages/client/.next/static/$dir_path|$file_name"
                done | sort > "$temp_files"

                # Build JSON using awk
                local cdn_manifest=$(awk -F'|' '
                BEGIN {
                    print "{"
                    current_dir = ""
                    first_dir = 1
                }
                {
                    dir = $1
                    file = $2

                    if (dir != current_dir) {
                        if (current_dir != "") {
                            print "  ],"
                        }
                        if (first_dir) {
                            first_dir = 0
                        } else if (current_dir == "") {
                            # This handles the very first directory
                        }
                        printf "  \"%s\": [\n", dir
                        printf "    \"%s\"", file
                        current_dir = dir
                    } else {
                        printf ",\n    \"%s\"", file
                    }
                }
                END {
                    if (current_dir != "") {
                        print "\n  ]"
                    }
                    print "}"
                }' "$temp_files")

                rm -f "$temp_files"
                verbose_log "Generated CDN manifest with static assets"
                echo "$cdn_manifest"
            else
                echo "{}"
            fi
            ;;
        server)
            # Server packages typically don't have static assets for CDN
            verbose_log "Server package - no CDN assets to manifest"
            echo "{}"
            ;;
    esac
}

# Copy build artifacts into pruned workspace
copy_build_artifacts() {
    local pruned_workspace="$1"
    local package_dir="$REPO_ROOT/packages/$PACKAGE"
    local target_package_dir="$pruned_workspace/packages/$PACKAGE"

    if [ "$DRY_RUN" = true ]; then
        verbose_log "DRY RUN: Would copy build artifacts from $package_dir to $target_package_dir"
        return
    fi

    verbose_log "Copying build artifacts for package: $PACKAGE"

    # Ensure target package directory exists
    mkdir -p "$target_package_dir"

    case "$PACKAGE" in
        client)
            # Copy Next.js build outputs
            if [ -d "$package_dir/.next" ]; then
                if [ "$USE_CDN" = true ]; then
                    verbose_log "Copying .next directory (excluding static assets for CDN)"
                    # Copy everything except static directory
                    find "$package_dir/.next" -mindepth 1 -maxdepth 1 ! -name "static" -exec cp -r {} "$target_package_dir/.next/" \;

                    # Create empty static directory to maintain structure
                    mkdir -p "$target_package_dir/.next/static"
                    verbose_log "Static assets excluded - will be served from CDN"
                else
                    verbose_log "Copying .next directory (including static assets)"
                    cp -r "$package_dir/.next" "$target_package_dir/.next"
                fi
            fi

            # Copy public directory if it exists
            if [ -d "$package_dir/public" ]; then
                verbose_log "Copying public directory"
                cp -r "$package_dir/public" "$target_package_dir/public"
            fi
            ;;
        server)
            # Copy server build outputs
            if [ -d "$package_dir/dist" ]; then
                verbose_log "Copying dist directory"
                cp -r "$package_dir/dist" "$target_package_dir/dist"
            fi
            # Server packages are not affected by CDN mode
            ;;
    esac

    verbose_log "Build artifacts copied successfully"
}

# Get environment file path
get_env_file_path() {
    # Check for environment files in dotenv directory structure as per BUILD_AND_DEPLOY.md
    local dotenv_dir="$HOME_DIR/tobeit69/dotenv/$PACKAGE"
    local env_file="$dotenv_dir/.env.$ENVIRONMENT"

    if [ -f "$env_file" ]; then
        echo "$env_file"
        return
    fi

    # Fallback to package-level environment files
    local package_dir="$REPO_ROOT/packages/$PACKAGE"
    local package_env_file="$package_dir/.env.$ENVIRONMENT"
    if [ -f "$package_env_file" ]; then
        echo "$package_env_file"
        return
    fi

    # If no environment-specific file, check for generic .env
    local generic_env_file="$package_dir/.env"
    if [ -f "$generic_env_file" ]; then
        echo "$generic_env_file"
        return
    fi

    verbose_log "No environment file found for $PACKAGE in environment $ENVIRONMENT"
    echo ""
}

# Add environment file and metadata
add_deployment_metadata() {
    local pruned_workspace="$1"
    local commit_hash=""
    local timestamp=""

    if [ "$DRY_RUN" = true ]; then
        verbose_log "DRY RUN: Would add deployment metadata to $pruned_workspace"
        return
    fi

    verbose_log "Adding deployment metadata"

    # Get git commit hash if available
    if [ -d "$REPO_ROOT/.git" ]; then
        commit_hash=$(cd "$REPO_ROOT" && git rev-parse HEAD 2>/dev/null || echo "unknown")
    else
        commit_hash="unknown"
    fi

    # Generate timestamp
    timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    # Copy environment file if it exists
    local env_file_path
    env_file_path=$(get_env_file_path)

    if [ -n "$env_file_path" ] && [ -f "$env_file_path" ]; then
        verbose_log "Copying environment file: $env_file_path"
        cp "$env_file_path" "$pruned_workspace/.env"
    else
        verbose_log "No environment file found, skipping environment file copy"
    fi

    # Generate CDN asset manifest
    local cdn_assets_json
    cdn_assets_json=$(generate_cdn_asset_manifest)

    # Generate metadata.json
    local metadata_file="$pruned_workspace/metadata.json"
    local node_version=""
    local pnpm_version=""

    # Get versions if available
    node_version=$(node --version 2>/dev/null | sed 's/^v//' || echo "unknown")
    pnpm_version=$(pnpm --version 2>/dev/null || echo "unknown")

    verbose_log "Generating metadata.json with CDN assets manifest"

    # Create metadata with CDN assets using jq for proper JSON formatting
    if command -v jq >/dev/null 2>&1; then
        # Use jq to properly merge the CDN assets into metadata
        if [ "$USE_CDN" = true ]; then
            cat > "$metadata_file" << EOF
{
  "environment": "$ENVIRONMENT",
  "package": "$PACKAGE",
  "commit": "$commit_hash",
  "timestamp": "$timestamp",
  "buildInfo": {
    "nodeVersion": "$node_version",
    "pnpmVersion": "$pnpm_version",
    "buildTime": "$timestamp"
  },
  "assetPrefix": "$NEXT_CDN_ASSETS_URL",
  "cdnAssets": $cdn_assets_json
}
EOF
        else
            cat > "$metadata_file" << EOF
{
  "environment": "$ENVIRONMENT",
  "package": "$PACKAGE",
  "commit": "$commit_hash",
  "timestamp": "$timestamp",
  "buildInfo": {
    "nodeVersion": "$node_version",
    "pnpmVersion": "$pnpm_version",
    "buildTime": "$timestamp"
  },
  "cdnAssets": $cdn_assets_json
}
EOF
        fi
    else
        # Fallback without jq (less robust but functional)
        if [ "$USE_CDN" = true ]; then
            cat > "$metadata_file" << EOF
{
  "environment": "$ENVIRONMENT",
  "package": "$PACKAGE",
  "commit": "$commit_hash",
  "timestamp": "$timestamp",
  "buildInfo": {
    "nodeVersion": "$node_version",
    "pnpmVersion": "$pnpm_version",
    "buildTime": "$timestamp"
  },
  "assetPrefix": "$NEXT_CDN_ASSETS_URL",
  "cdnAssets": $cdn_assets_json
}
EOF
        else
            cat > "$metadata_file" << EOF
{
  "environment": "$ENVIRONMENT",
  "package": "$PACKAGE",
  "commit": "$commit_hash",
  "timestamp": "$timestamp",
  "buildInfo": {
    "nodeVersion": "$node_version",
    "pnpmVersion": "$pnpm_version",
    "buildTime": "$timestamp"
  },
  "cdnAssets": $cdn_assets_json
}
EOF
        fi
    fi

    verbose_log "Deployment metadata added successfully"
}

# Package artifact as tarball
package_artifact() {
    local pruned_workspace="$1"
    local commit_hash=""
    local artifact_name=""

    if [ "$DRY_RUN" = true ]; then
        verbose_log "DRY RUN: Would package artifact from $pruned_workspace"
        return
    fi

    # Get git commit hash for artifact naming
    if [ -d "$REPO_ROOT/.git" ]; then
        commit_hash=$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    else
        commit_hash="unknown"
    fi

    # Generate artifact name as per BUILD_AND_DEPLOY.md specification
    if [ "$USE_CDN" = true ]; then
        artifact_name="tobeit69-$PACKAGE-$ENVIRONMENT-$commit_hash-cdn.tar.gz"
    else
        artifact_name="tobeit69-$PACKAGE-$ENVIRONMENT-$commit_hash.tar.gz"
    fi
    local artifact_path="$OUTPUT_DIR/$artifact_name"

    verbose_log "Packaging artifact: $artifact_name"

    # Create tarball from pruned workspace contents
    cd "$pruned_workspace"
    tar -czf "$artifact_path" .

    if [ ! -f "$artifact_path" ]; then
        error "Failed to create artifact: $artifact_path"
    fi

    # Get artifact size for logging
    local artifact_size
    artifact_size=$(du -h "$artifact_path" | cut -f1)

    log "Artifact created successfully:"
    log "  Name: $artifact_name"
    log "  Path: $artifact_path"
    log "  Size: $artifact_size"
    log "  Package: $PACKAGE"
    log "  Environment: $ENVIRONMENT"
    log "  Commit: $commit_hash"
}

# Cleanup temporary files
cleanup_temp_files() {
    local temp_dir="$OUTPUT_DIR/.temp-prune-$$"

    if [ "$KEEP_TEMP" = true ]; then
        if [ -d "$temp_dir" ]; then
            verbose_log "Keeping temporary directory for debugging: $temp_dir"
        fi
        return
    fi

    if [ -d "$temp_dir" ]; then
        if [ "$DRY_RUN" = true ]; then
            verbose_log "DRY RUN: Would cleanup temporary directory: $temp_dir"
        else
            verbose_log "Cleaning up temporary directory: $temp_dir"
            rm -rf "$temp_dir"
        fi
    fi
}

# Trap to ensure cleanup on exit (even on errors)
cleanup_on_exit() {
    if [ "$KEEP_TEMP" = false ] && [ -n "${OUTPUT_DIR:-}" ]; then
        local temp_pattern="$OUTPUT_DIR/.temp-prune-*"
        for temp_dir in $temp_pattern; do
            if [ -d "$temp_dir" ]; then
                verbose_log "Emergency cleanup: $temp_dir"
                rm -rf "$temp_dir" 2>/dev/null || true
            fi
        done
    fi
}

# Main execution function
main() {
    # Set up cleanup trap for emergency cleanup on exit/error
    trap cleanup_on_exit EXIT INT TERM

    # Parse and validate arguments
    parse_args "$@"
    detect_monorepo_root
    validate_package
    detect_environment
    validate_environment

    log "Starting artifact collection for package: $PACKAGE"

    if [ "$USE_CDN" = true ]; then
        log "CDN mode enabled - static assets will be excluded from artifact"
        log "CDN assets manifest will be generated in metadata.json"
    else
        log "Standard mode - all assets will be included in artifact"
    fi

    # Check dependencies and validate inputs
    check_dependencies
    validate_package_structure
    validate_build_outputs
    validate_cdn_environment
    prepare_output_directory

    if [ "$DRY_RUN" = true ]; then
        log "DRY RUN: All validations passed. Artifact collection would proceed normally."
        log "DRY RUN: Package: $PACKAGE, Environment: $ENVIRONMENT, Output: $OUTPUT_DIR"
        exit 0
    fi

    # Create pruned workspace and collect artifacts
    local pruned_workspace
    pruned_workspace=$(create_pruned_workspace)

    copy_build_artifacts "$pruned_workspace"
    add_deployment_metadata "$pruned_workspace"
    package_artifact "$pruned_workspace"

    # Cleanup temporary files (automatic unless --keep-temp is used)
    cleanup_temp_files

    log "Artifact collection completed successfully"
}

# Execute main function with all arguments
main "$@"