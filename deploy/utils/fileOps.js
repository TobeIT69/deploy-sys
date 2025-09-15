import fs from "fs-extra";
import { exec } from "child_process";
import { promisify } from "util";
import * as tar from "tar";
import { tmpdir } from "os";
import { join } from "path";

const execAsync = promisify(exec);

export async function extractArtifact(artifactPath, targetDir) {
  await fs.ensureDir(targetDir);

  await tar.extract({
    file: artifactPath,
    cwd: targetDir,
    strip: 0,
  });
}

export async function createTempDir(prefix = "deploy-") {
  const tempDir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );
  await fs.ensureDir(tempDir);
  return tempDir;
}

export async function readMetadata(artifactPath) {
  const tempDir = await createTempDir("metadata-");

  try {
    await extractArtifact(artifactPath, tempDir);
    const metadataPath = join(tempDir, "metadata.json");

    if (!(await fs.pathExists(metadataPath))) {
      throw new Error("Artifact missing metadata.json");
    }

    return await fs.readJson(metadataPath);
  } finally {
    await fs.remove(tempDir);
  }
}

export async function updateSymlink(target, linkPath) {
  if (await fs.pathExists(linkPath)) {
    await fs.remove(linkPath);
  }
  await fs.symlink(target, linkPath);
}

export async function execCommand(command) {
  const { stdout, stderr } = await execAsync(command);
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}
