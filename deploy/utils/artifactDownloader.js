import fs from "fs-extra";
import path from "path";
import { execCommand, createTempDir } from "./fileOps.js";
import { getOctokit, getRepositoryInfo } from "./githubClient.js";

export async function downloadArtifactFromRun(workflowRunId, packageName) {
  const octokit = await getOctokit();
  const { owner, repo } = getRepositoryInfo();

  try {
    // List artifacts for the workflow run
    const artifacts = await octokit.rest.actions.listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: workflowRunId,
    });

    // Find matching artifact using partial match (package only)
    const expectedPrefix = `tobeit69-${packageName}-`;
    const artifact = artifacts.data.artifacts.find(
      (a) => a.name.startsWith(expectedPrefix) && a.name.endsWith(".tar.gz")
    );

    if (!artifact) {
      const availableArtifacts = artifacts.data.artifacts
        .map((a) => a.name)
        .join(", ");
      throw new Error(
        `Artifact not found. Expected pattern: ${expectedPrefix}*.tar.gz, Available: ${availableArtifacts}`
      );
    }

    // Download the artifact
    const download = await octokit.rest.actions.downloadArtifact({
      owner,
      repo,
      artifact_id: artifact.id,
      archive_format: "zip",
    });

    // Create temporary directory for extraction
    const tempDir = await createTempDir();
    const zipPath = path.join(tempDir, `${artifact.name}.zip`);
    const extractDir = path.join(tempDir, "extracted");

    // Save downloaded zip data to file
    await fs.writeFile(zipPath, Buffer.from(download.data));

    // Extract the zip file using system unzip command
    await fs.ensureDir(extractDir);
    await execCommand(`unzip -q "${zipPath}" -d "${extractDir}"`);

    // Find the .tar.gz file in the extracted contents
    const extractedFiles = await fs.readdir(extractDir);
    const tarGzFile = extractedFiles.find((f) => f.endsWith(".tar.gz"));

    if (!tarGzFile) {
      throw new Error(
        `No .tar.gz file found in downloaded artifact. Files: ${extractedFiles.join(
          ", "
        )}`
      );
    }

    const artifactPath = path.join(extractDir, tarGzFile);

    // Verify the artifact file exists and is readable
    if (!(await fs.pathExists(artifactPath))) {
      throw new Error(`Artifact file not found at: ${artifactPath}`);
    }

    return {
      artifactPath,
      tempDir,
      artifact: {
        id: artifact.id,
        name: artifact.name,
        size: artifact.size_in_bytes,
      },
    };
  } catch (error) {
    throw new Error(`Failed to download artifact: ${error.message}`);
  }
}

export async function cleanupArtifactDownload(tempDir) {
  if (tempDir && (await fs.pathExists(tempDir))) {
    await fs.remove(tempDir);
  }
}
