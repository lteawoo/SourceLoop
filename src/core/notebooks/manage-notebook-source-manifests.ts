import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { getVaultPaths } from "../vault/paths.js";
import { getNotebookNote, getNotebookSourceManifestNote, getTopicIndexNote, toWikiLink } from "../vault/notes.js";
import { notebookSourceKindSchema, notebookSourceManifestSchema, type NotebookSourceKind, type NotebookSourceManifest } from "../../schemas/notebook-source.js";
import { loadNotebookBinding } from "../runs/load-artifacts.js";
import { loadTopic, refreshTopicArtifacts } from "../topics/manage-topics.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";
import { slugify } from "../../lib/slugify.js";

export type DeclareNotebookSourceManifestInput = {
  topicId: string;
  notebookBindingId: string;
  kind: string;
  title: string;
  description?: string;
  itemCount?: number;
  refs?: string[];
  force?: boolean;
  cwd?: string;
};

export type DeclareNotebookSourceManifestResult = {
  manifest: NotebookSourceManifest;
  markdownPath: string;
  jsonPath: string;
};

export async function declareNotebookSourceManifest(
  input: DeclareNotebookSourceManifestInput
): Promise<DeclareNotebookSourceManifestResult> {
  const workspace = await loadWorkspace(input.cwd);
  const vault = getVaultPaths(workspace);
  await mkdir(vault.notebookSourcesDir, { recursive: true });

  const [{ topic }, { binding }] = await Promise.all([
    loadTopic(input.topicId, input.cwd),
    loadNotebookBinding(input.notebookBindingId, input.cwd)
  ]);

  if (binding.topicId !== input.topicId) {
    throw new Error(
      `Notebook binding ${binding.id} belongs to ${binding.topicId ?? "legacy-notebook-first"}, not topic ${input.topicId}.`
    );
  }

  const kind = notebookSourceKindSchema.parse(input.kind);
  const title = normalizeObsidianText(input.title);
  const now = new Date().toISOString();
  const id = `notebook-source-${slugify(`${input.topicId}-${binding.id}-${title}`)}`;
  const jsonPath = path.join(vault.notebookSourcesDir, `${id}.json`);

  if (!input.force && (await fileExists(jsonPath))) {
    throw new Error(`Notebook source manifest ${id} already exists. Re-run with --force to overwrite it.`);
  }

  const manifest = notebookSourceManifestSchema.parse({
    id,
    type: "notebook_source_manifest",
    topicId: input.topicId,
    notebookBindingId: input.notebookBindingId,
    kind,
    title,
    ...(input.description ? { description: normalizeObsidianText(input.description) } : {}),
    ...(input.itemCount !== undefined ? { itemCount: input.itemCount } : {}),
    refs: input.refs ?? [],
    createdAt: now,
    updatedAt: now
  });

  const note = getNotebookSourceManifestNote(workspace, manifest);
  await writeJsonFile(jsonPath, manifest);
  await writeFile(note.absolutePath, buildManifestMarkdown(workspace, manifest, topic, binding), "utf8");
  await refreshTopicArtifacts(input.topicId, input.cwd);

  return {
    manifest,
    markdownPath: note.absolutePath,
    jsonPath
  };
}

export async function loadNotebookSourceManifest(
  manifestId: string,
  cwd?: string
): Promise<{ workspace: Awaited<ReturnType<typeof loadWorkspace>>; manifest: NotebookSourceManifest; path: string }> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const manifestPath = path.join(vault.notebookSourcesDir, `${manifestId}.json`);
  const raw = await readFile(manifestPath, "utf8");
  return {
    workspace,
    manifest: notebookSourceManifestSchema.parse(JSON.parse(raw)),
    path: manifestPath
  };
}

export async function listNotebookSourceManifests(cwd?: string): Promise<NotebookSourceManifest[]> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  try {
    const entries = await readdir(vault.notebookSourcesDir);
    const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
    const raw = await Promise.all(jsonFiles.map((entry) => readFile(path.join(vault.notebookSourcesDir, entry), "utf8")));
    return raw
      .map((value) => notebookSourceManifestSchema.parse(JSON.parse(value)))
      .sort((left, right) => left.title.localeCompare(right.title));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

function buildManifestMarkdown(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  manifest: NotebookSourceManifest,
  topic: Awaited<ReturnType<typeof loadTopic>>["topic"],
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"]
): string {
  const title = normalizeObsidianText(manifest.title, manifest.id);
  return toFrontmatterMarkdown(
    {
      type: "notebook-source",
      title,
      aliases: makeAliases(manifest.id),
      tags: makeTags("sourceloop", "source", "notebook-backed", manifest.kind),
      topic: normalizeObsidianText(topic.name, topic.id),
      notebook: normalizeObsidianText(binding.name, binding.id),
      source_kind: manifest.kind,
      ...(manifest.itemCount !== undefined ? { item_count: String(manifest.itemCount) } : {}),
      created: manifest.createdAt,
      updated: manifest.updatedAt
    },
    `# ${title}

## Topic
- ${toWikiLink(workspace, getTopicIndexNote(workspace, topic).absolutePath, normalizeObsidianText(topic.name, topic.id))}

## Notebook
- ${toWikiLink(workspace, getNotebookNote(workspace, binding).absolutePath, normalizeObsidianText(binding.name, binding.id))}

## Source Kind
- ${manifest.kind}

## Description
${manifest.description ?? "No description provided."}

## Declared References
${manifest.refs.length > 0 ? manifest.refs.map((ref) => `- ${ref}`).join("\n") : "- none"}
`
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
