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
import { getChromeTargetNote, getNotebookNote, getTopicIndexNote, toWikiLink } from "../vault/notes.js";

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
  const attachTarget = input.attachTargetId ? await loadChromeAttachTarget(input.attachTargetId, input.cwd) : undefined;
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

  const note = getNotebookNote(workspace, binding);
  const jsonPath = path.join(vault.notebooksDir, `${binding.id}.json`);
  const markdownPath = note.absolutePath;

  if (!input.force && (await fileExists(jsonPath))) {
    throw new Error(`Notebook binding ${binding.id} already exists. Re-run with --force to overwrite it.`);
  }

  const markdown = toFrontmatterMarkdown(
    {
      type: "notebook",
      title: normalizeObsidianText(binding.name, binding.id),
      aliases: makeAliases(binding.id),
      tags: makeTags("sourceloop", "notebook", "notebooklm", ...binding.topics),
      topic: normalizeObsidianText(binding.topic),
      access: binding.accessMode,
      ...(binding.description ? { description: binding.description } : {}),
      created: binding.createdAt,
      updated: binding.createdAt
    },
    buildNotebookBody(workspace, binding, topic?.topic, attachTarget?.target)
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

function buildNotebookBody(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  binding: NotebookBinding,
  topic?: Awaited<ReturnType<typeof loadTopic>>["topic"],
  attachTarget?: Awaited<ReturnType<typeof loadChromeAttachTarget>>["target"]
): string {
  const title = normalizeObsidianText(binding.name, binding.id);
  const lines = [
    `# ${title}`,
    "",
    `- Topic: ${binding.topicId && topic ? toWikiLink(workspace, getTopicIndexNote(workspace, topic).absolutePath, normalizeObsidianText(topic.name, topic.id)) : normalizeObsidianText(binding.topic)}`,
    `- Access: ${binding.accessMode}`,
    `- Notebook URL: ${binding.notebookUrl}`
  ];

  if (binding.attachTargetId && attachTarget) {
    lines.push(
      `- Attach Target: ${toWikiLink(workspace, getChromeTargetNote(workspace, attachTarget).absolutePath, normalizeObsidianText(attachTarget.name, attachTarget.id))}`
    );
  }

  if (binding.description) {
    lines.push("", "## Description", binding.description);
  }

  if (binding.topics.length > 0) {
    lines.push("", "## Topics", ...binding.topics.map((topic) => `- ${topic}`));
  }
  return lines.join("\n");
}
