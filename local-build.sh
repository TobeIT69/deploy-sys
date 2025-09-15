#!/bin/bash

# local-build.sh
# Purpose: Local build script for TobeIT69 packages with dotenv symlink setup
# Usage: ./local-build.sh <package> <environment>

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect if we're running from symlink at ~/tobeit69 or directly from deploy-sys
if [[ "$PWD" == */tobeit69 ]] && [[ -L "$0" ]]; then
    # Running from ~/tobeit69 via symlink
    BASE_DIR="$(pwd)"
    GIT_DIR="$BASE_DIR/git"
    DOTENV_DIR="$BASE_DIR/dotenv"
else
    # Running directly from deploy-sys directory
    BASE_DIR="$(dirname "$SCRIPT_DIR")"
    GIT_DIR="$BASE_DIR/git"
    DOTENV_DIR="$BASE_DIR/dotenv"
fi

# Parameters
PACKAGE=""
ENVIRONMENT=""

# Logging functions
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >&2
}

error() {
    log "ERROR: $*" >&2
    exit 1
}

# Usage function
usage() {
    cat << EOF
Usage: $0 <package> <environment>

Local build script for TobeIT69 packages with dotenv symlink setup.

Arguments:
  <package>        Package name (client|server) - required
  <environment>    Environment (main|staging|prod) - required

Examples:
  # Build client for staging environment
  ./local-build.sh client staging

  # Build server for production environment
  ./local-build.sh server prod
EOF
}

# Parse command line arguments
parse_args() {
    if [ $# -ne 2 ]; then
        usage
        exit 1
    fi

    PACKAGE="$1"
    ENVIRONMENT="$2"
}

# Validate package parameter
validate_package() {
    case "$PACKAGE" in
        client|server)
            log "Package '$PACKAGE' is valid"
            ;;
        *)
            error "Invalid package '$PACKAGE'. Must be 'client' or 'server'"
            ;;
    esac
}

# Validate environment parameter
validate_environment() {
    case "$ENVIRONMENT" in
        main|staging|prod)
            log "Environment '$ENVIRONMENT' is valid"
            ;;
        *)
            error "Invalid environment '$ENVIRONMENT'. Must be 'main', 'staging', or 'prod'"
            ;;
    esac
}

# Check if required directories exist
check_directories() {
    if [ ! -d "$GIT_DIR" ]; then
        error "Git directory does not exist: $GIT_DIR"
    fi

    if [ ! -d "$DOTENV_DIR" ]; then
        error "Dotenv directory does not exist: $DOTENV_DIR"
    fi

    log "Directory validation passed"
}

# Check if required tools are available
check_dependencies() {
    local missing_deps=()

    if ! command -v pnpm >/dev/null 2>&1; then
        missing_deps+=("pnpm")
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        error "Missing required dependencies: ${missing_deps[*]}"
    fi

    log "All required dependencies are available"
}

# Setup dotenv symlink for the package
setup_dotenv_symlink() {
    log "Setting up dotenv symlink for $PACKAGE in $ENVIRONMENT environment"

    local package_dir="$GIT_DIR/packages/$PACKAGE"
    local env_file="$DOTENV_DIR/$PACKAGE/.env.$ENVIRONMENT"
    local target_env="$package_dir/.env.local"

    if [ ! -d "$package_dir" ]; then
        error "Package  directory does not exist: $package_dir"
    fi

    if [ ! -f "$env_file" ]; then
        error "Environment file does not exist: $env_file"
    fi

    # Remove existing .env file or symlink
    if [ -e "$target_env" ] || [ -L "$target_env" ]; then
        log "Removing existing .env for $PACKAGE: $target_env"
        rm -f "$target_env"
    fi

    # Create symlink
    log "Creating symlink: $target_env -> $env_file"
    ln -s "$env_file" "$target_env"

    # Verify symlink was created successfully
    if [ ! -L "$target_env" ]; then
        error "Failed to create symlink for $PACKAGE environment file"
    fi

    log "Dotenv symlink created successfully for $PACKAGE"
}

# Run type checking
run_type_check() {
    log "Running type checking for $PACKAGE"

    cd "$GIT_DIR"
    pnpm run --filter="$PACKAGE" check-types

    log "Type checking completed successfully"
}

# Checkout correct git branch and pull changes
checkout_and_pull() {
    log "Checking out $ENVIRONMENT branch and pulling changes"

    cd "$GIT_DIR"

    # Check if we're already on the correct branch
    local current_branch
    current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

    if [ "$current_branch" != "$ENVIRONMENT" ]; then
        log "Switching from branch '$current_branch' to '$ENVIRONMENT'"
        git checkout "$ENVIRONMENT"
    else
        log "Already on branch '$ENVIRONMENT'"
    fi

    # Pull latest changes
    log "Pulling latest changes from origin/$ENVIRONMENT"
    git pull origin "$ENVIRONMENT"

    # Install dependencies
    log "Installing dependencies with pnpm install"
    pnpm install

    log "Git checkout, pull, and dependency installation completed successfully"
}

# Run build
run_build() {
    log "Running build for $PACKAGE"

    cd "$GIT_DIR"
    pnpm run --filter="$PACKAGE" build

    log "Build completed successfully"
}

# Main execution function
main() {
    # Parse and validate arguments
    parse_args "$@"
    validate_package
    validate_environment

    log "Starting local build process"
    log "Package: $PACKAGE"
    log "Environment: $ENVIRONMENT"
    log "Base directory: $BASE_DIR"
    log "Git directory: $GIT_DIR"
    log "Dotenv directory: $DOTENV_DIR"

    # Check dependencies and directories
    check_dependencies
    check_directories

    # Checkout correct branch and pull changes
    checkout_and_pull

    # Setup dotenv symlink
    setup_dotenv_symlink

    # Run type checking
    run_type_check

    # Run build
    run_build

    log "Local build process completed successfully"
}

# Execute main function with all arguments
main "$@"