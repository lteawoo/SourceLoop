import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { notebookBindingSchema, type NotebookBinding } from "../../schemas/notebook.js";
import { slugify } from "../../lib/slugify.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { getVaultPaths } from "../vault/paths.js";
import { loadChromeAttachTarget } from "../attach/manage-targets.js";
import { loadTopic, refreshTopicArtifacts } from "../topics/manage-topics.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";

export type BindNotebookInput = {
  name: string;
  topic: string;
  topicId?: string;
  notebookUrl: string;
  accessMode: "owner" | "shared" | "chat-only";
  force?: boolean;
  description?: string;
  topics?: string[];
  attachTargetId?: string;
  browserProfile?: string;
  cwd?: string;
};

export type BindNotebookResult = {
  binding: NotebookBinding;
  markdownPath: string;
  jsonPath: string;
};

export async function bindNotebook(input: BindNotebookInput): Promise<BindNotebookResult> {
  const workspace = await loadWorkspace(input.cwd);
  const vault = getVaultPaths(workspace);
  await mkdir(vault.notebooksDir, { recursive: true });
  if (input.attachTargetId) {
    await loadChromeAttachTarget(input.attachTargetId, input.cwd);
  }
  const topic = input.topicId ? await loadTopic(input.topicId, input.cwd) : undefined;
  const topicLabel = normalizeObsidianText(topic?.topic.name ?? input.topic);

  const binding = notebookBindingSchema.parse({
    id: `notebook-${slugify(input.name)}`,
    type: "notebook_binding",
    name: input.name,
    topic: topicLabel,
    topicId: input.topicId,
    notebookUrl: input.notebookUrl,
    accessMode: input.accessMode,
    description: input.description,
    topics: input.topics ?? [],
    attachTargetId: input.attachTargetId,
    browserProfile: input.browserProfile,
    createdAt: new Date().toISOString()
  });

  const basePath = path.join(vault.notebooksDir, binding.id);
  const markdownPath = `${basePath}.md`;
  const jsonPath = `${basePath}.json`;

  if (!input.force && (await fileExists(markdownPath))) {
    throw new Error(`Notebook binding ${binding.id} already exists. Re-run with --force to overwrite it.`);
  }

  const markdown = toFrontmatterMarkdown(
    {
      id: binding.id,
      type: "notebook",
      title: normalizeObsidianText(binding.name, binding.id),
      aliases: makeAliases(binding.id),
      tags: makeTags("sourceloop", "notebook", "notebooklm"),
      name: normalizeObsidianText(binding.name, binding.id),
      topic: normalizeObsidianText(binding.topic),
      topic_id: binding.topicId,
      notebook_url: binding.notebookUrl,
      access_mode: binding.accessMode,
      description: binding.description,
      topics: binding.topics,
      attach_target_id: binding.attachTargetId,
      browser_profile: binding.browserProfile,
      created_at: binding.createdAt
    },
    buildNotebookBody(binding)
  );

  await writeFile(markdownPath, markdown, "utf8");
  await writeJsonFile(jsonPath, binding);
  if (binding.topicId) {
    await refreshTopicArtifacts(binding.topicId, input.cwd);
  }

  return {
    binding,
    markdownPath,
    jsonPath
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildNotebookBody(binding: NotebookBinding): string {
  const title = normalizeObsidianText(binding.name, binding.id);
  const lines = [
    `# ${title}`,
    "",
    `- Topic: ${normalizeObsidianText(binding.topic)}`,
    `- Topic ID: ${binding.topicId ?? "legacy-notebook-first"}`,
    `- Topic Artifact: ${
      binding.topicId ? toMarkdownLink(binding.topicId, `../topics/${binding.topicId}/index.md`) : "none"
    }`,
    `- Access: ${binding.accessMode}`,
    `- Notebook URL: ${binding.notebookUrl}`
  ];

  if (binding.attachTargetId) {
    lines.push(`- Attach Target: ${toMarkdownLink(binding.attachTargetId, `../chrome-targets/${binding.attachTargetId}.md`)}`);
  }

  if (binding.description) {
    lines.push("", "## Description", binding.description);
  }

  if (binding.topics.length > 0) {
    lines.push("", "## Topics", ...binding.topics.map((topic) => `- ${topic}`));
  }

  return lines.join("\n");
}

function toMarkdownLink(label: string, targetPath: string): string {
  return `[${label}](${targetPath})`;
}
