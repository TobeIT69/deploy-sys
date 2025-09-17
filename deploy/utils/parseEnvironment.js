/**
 * Parse environment string in format {env}-{package} into separate components
 * @param {string} environment - Environment string like "prod-client" or "staging-server"
 * @returns {{env: string, package: string}} Parsed environment and package
 * @throws {Error} If environment format is invalid
 */
function parseEnvironment(environment) {
  if (!environment || typeof environment !== "string") {
    throw new Error("Environment must be a non-empty string");
  }

  const parts = environment.split("-");

  if (parts.length !== 2) {
    throw new Error(
      `Invalid environment format: ${environment}. Expected format: {env}-{package}`
    );
  }

  const [env, packageName] = parts;

  // Validate environment
  const validEnvs = ["main", "staging", "prod"];
  if (!validEnvs.includes(env)) {
    throw new Error(
      `Invalid environment: ${env}. Must be one of: ${validEnvs.join(", ")}`
    );
  }

  // Validate package
  const validPackages = ["client", "server"];
  if (!validPackages.includes(packageName)) {
    throw new Error(
      `Invalid package: ${packageName}. Must be one of: ${validPackages.join(
        ", "
      )}`
    );
  }

  return {
    env,
    package: packageName,
  };
}

/**
 * Format environment and package into deployment environment string
 * @param {string} env - Environment (main, staging, prod)
 * @param {string} packageName - Package name (client, server)
 * @returns {string} Formatted environment string like "prod-client"
 */
function formatEnvironment(env, packageName) {
  return `${env}-${packageName}`;
}

export { parseEnvironment, formatEnvironment };
