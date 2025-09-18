import { DISCORD } from "../config.js";
import { getRepositoryInfo } from "./githubClient.js";

const STATUS_COLORS = {
  deploying: 0x3498db, // Blue
  success: 0x2ecc71, // Green
  failure: 0xe74c3c, // Red
  in_progress: 0xf39c12, // Orange
};

const STATUS_EMOJIS = {
  deploying: "🚀",
  success: "✅",
  failure: "❌",
  in_progress: "⚡",
};

export async function sendDiscordNotification(status, options = {}) {
  // Skip if Discord is not configured
  if (!DISCORD.enabled) {
    return null;
  }

  const {
    packageName,
    environment,
    commit,
    error,
    deploymentId,
    versionInfo,
    workflowRunId,
    isLocalArtifact = false,
    triggerSource = "manual", // "webhook", "manual"
  } = options;

  try {
    const embed = createEmbed(status, {
      packageName,
      environment,
      commit,
      error,
      deploymentId,
      versionInfo,
      workflowRunId,
      isLocalArtifact,
      triggerSource,
    });

    const payload = {
      embeds: [embed],
    };

    const response = await fetch(DISCORD.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISCORD.timeout),
    });

    if (!response.ok) {
      throw new Error(
        `Discord webhook returned ${response.status}: ${response.statusText}`
      );
    }

    return true;
  } catch (error) {
    // Log error but don't fail the deployment process
    console.warn(`Failed to send Discord notification: ${error.message}`);
    return false;
  }
}

function createEmbed(status, options) {
  const {
    packageName,
    environment,
    commit,
    error,
    deploymentId,
    versionInfo,
    workflowRunId,
    isLocalArtifact,
    triggerSource,
  } = options;

  const emoji = STATUS_EMOJIS[status] || "📦";
  const color = STATUS_COLORS[status] || 0x95a5a6;

  const embed = {
    color,
    timestamp: new Date().toISOString(),
    footer: {
      text: "TobeIT69 Deploy System",
    },
  };

  // Set title and description based on status
  switch (status) {
    case "deploying":
      embed.title = `${emoji} Deployment Started`;
      embed.description = `Starting deployment of **${packageName}** to **${environment}**`;
      break;

    case "in_progress":
      embed.title = `${emoji} Deployment In Progress`;
      embed.description = `Deploying **${packageName}** to **${environment}**`;
      break;

    case "success":
      embed.title = `${emoji} Deployment Successful`;
      embed.description = `Successfully deployed **${packageName}** to **${environment}**`;
      break;

    case "failure":
      embed.title = `${emoji} Deployment Failed`;
      embed.description = `Failed to deploy **${packageName}** to **${environment}**`;
      if (error) {
        embed.fields = [
          {
            name: "Error",
            value: `\`\`\`${
              error.length > 1000 ? error.substring(0, 997) + "..." : error
            }\`\`\``,
            inline: false,
          },
        ];
      }
      break;

    default:
      embed.title = `${emoji} Deployment Update`;
      embed.description = `Status update for **${packageName}** deployment to **${environment}**`;
  }

  // Add fields with deployment details
  if (!embed.fields) {
    embed.fields = [];
  }

  if (packageName) {
    embed.fields.push({
      name: "Package",
      value: packageName,
      inline: true,
    });
  }

  if (environment) {
    embed.fields.push({
      name: "Environment",
      value: environment,
      inline: true,
    });
  }

  if (commit) {
    const shortCommit = commit.substring(0, 7);
    embed.fields.push({
      name: "Commit",
      value: `\`${shortCommit}\``,
      inline: true,
    });
  }

  if (versionInfo && status === "success") {
    embed.fields.push({
      name: "Version",
      value: `\`${versionInfo}\``,
      inline: false,
    });
  }

  if (deploymentId) {
    embed.fields.push({
      name: "Deployment ID",
      value: `\`${deploymentId}\``,
      inline: true,
    });
  }

  // Add source information
  if (isLocalArtifact) {
    embed.fields.push({
      name: "Source",
      value: "📁 Local Artifact",
      inline: true,
    });
  } else if (workflowRunId) {
    try {
      const { owner, repo } = getRepositoryInfo();
      const workflowUrl = `https://github.com/${owner}/${repo}/actions/runs/${workflowRunId}`;
      embed.fields.push({
        name: "Source",
        value: `🤖 [GitHub Actions](${workflowUrl})`,
        inline: true,
      });
    } catch (error) {
      // Fallback if repository info is not available
      embed.fields.push({
        name: "Source",
        value: `🤖 GitHub Actions (Run ID: ${workflowRunId})`,
        inline: true,
      });
    }
  }

  // Add trigger source information
  const triggerEmoji = triggerSource === "webhook" ? "🤖" : "👤";
  const triggerText =
    triggerSource === "webhook" ? "Automated (Webhook)" : "Manual";
  embed.fields.push({
    name: "Trigger",
    value: `${triggerEmoji} ${triggerText}`,
    inline: true,
  });

  return embed;
}
