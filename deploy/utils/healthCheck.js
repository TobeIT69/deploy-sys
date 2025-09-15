import { spawn } from "child_process";
import { HEALTH_CHECK, PORTS } from "../config.js";

export async function findAvailablePort(
  min = HEALTH_CHECK.portRange.min,
  max = HEALTH_CHECK.portRange.max
) {
  const { createServer } = await import("net");

  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > max) {
        reject(new Error(`No available ports in range ${min}-${max}`));
        return;
      }

      const server = createServer();
      server.listen(port, () => {
        server.close(() => resolve(port));
      });

      server.on("error", () => tryPort(port + 1));
    };

    tryPort(min);
  });
}

export async function startTestServer(packagePath, port, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["start"], {
      cwd: packagePath,
      env: { ...process.env, PORT: port.toString(), ...env },
      stdio: "pipe",
      detached: true, // Create new process group
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        // Kill entire process group to ensure npm and its children are terminated
        process.kill(-child.pid, "SIGTERM");
        reject(
          new Error(`Server failed to start within ${HEALTH_CHECK.timeout}ms`)
        );
      }
    }, HEALTH_CHECK.timeout);

    child.stdout.on("data", (data) => {
      const output = data.toString().toLowerCase();
      console.log(`[STDOUT] ${data.toString().trim()}`);
      if (
        output.includes("ready") ||
        output.includes("listening") ||
        output.includes("started") ||
        output.includes("server running") ||
        output.includes(`http://localhost:${port}`) ||
        output.includes(`:${port}`)
      ) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          resolve(child);
        }
      }
    });

    child.stderr.on("data", (data) => {
      console.log(`[STDERR] ${data.toString().trim()}`);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (!started) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

export async function healthCheck(url, retries = HEALTH_CHECK.retries) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, HEALTH_CHECK.interval)
      );
    }
  }
  return false;
}

export function getHealthCheckUrl(environment, packageName, port = null) {
  const targetPort = port || PORTS[environment][packageName];

  if (packageName === "server") {
    return `http://localhost:${targetPort}/health`;
  }
  return `http://localhost:${targetPort}`;
}
