import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { getTopicPaths, getVaultPaths } from "../vault/paths.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { slugify } from "../../lib/slugify.js";
import {
  researchTopicSchema,
  topicCorpusManifestSchema,
  type ResearchTopic,
  type TopicCorpusManifest,
  type TopicStatus
} from "../../schemas/topic.js";
import { sourceDocumentSchema } from "../../schemas/source.js";
import { notebookBindingSchema } from "../../schemas/notebook.js";
import { runIndexSchema } from "../../schemas/run.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";

export type CreateTopicInput = {
  name: string;
  goal?: string;
  intendedOutput?: string;
  cwd?: string;
  force?: boolean;
};

export type CreateTopicResult = {
  topic: ResearchTopic;
  corpus: TopicCorpusManifest;
  topicDir: string;
};

export async function createTopic(input: CreateTopicInput): Promise<CreateTopicResult> {
  const workspace = await loadWorkspace(input.cwd);
  const topicId = `topic-${slugify(input.name)}`;
  const topicPaths = getTopicPaths(workspace, topicId);
  await mkdir(topicPaths.topicDir, { recursive: true });

  if (!input.force && (await fileExists(topicPaths.indexJsonPath))) {
    throw new Error(`Topic ${topicId} already exists. Re-run with --force to overwrite it.`);
  }

  const now = new Date().toISOString();
  const topic = researchTopicSchema.parse({
    id: topicId,
    type: "research_topic",
    name: normalizeObsidianText(input.name),
    ...(input.goal ? { goal: input.goal } : {}),
    ...(input.intendedOutput ? { intendedOutput: input.intendedOutput } : {}),
    status: "initialized",
    createdAt: now,
    updatedAt: now
  });
  const corpus = topicCorpusManifestSchema.parse({
    id: `${topicId}-corpus`,
    type: "topic_corpus",
    topicId,
    sourceIds: [],
    notebookBindingIds: [],
    runIds: [],
    createdAt: now,
    updatedAt: now
  });

  await persistTopicArtifacts(topicPaths, topic, corpus);
  return { topic, corpus, topicDir: topicPaths.topicDir };
}

export async function loadTopic(
  topicId: string,
  cwd?: string
): Promise<{ workspace: Awaited<ReturnType<typeof loadWorkspace>>; topic: ResearchTopic; corpus: TopicCorpusManifest; paths: ReturnType<typeof getTopicPaths> }> {
  const workspace = await loadWorkspace(cwd);
  const paths = getTopicPaths(workspace, topicId);
  const [topicRaw, corpusRaw] = await Promise.all([
    readFile(paths.indexJsonPath, "utf8"),
    readFile(paths.corpusJsonPath, "utf8")
  ]);

  return {
    workspace,
    topic: researchTopicSchema.parse(JSON.parse(topicRaw)),
    corpus: topicCorpusManifestSchema.parse(JSON.parse(corpusRaw)),
    paths
  };
}

export async function listTopics(cwd?: string): Promise<ResearchTopic[]> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  try {
    const entries = await readdir(vault.topicsDir, { withFileTypes: true });
    const topicDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(vault.topicsDir, entry.name, "index.json"));
    const raw = await Promise.all(topicDirs.map((filePath) => readFile(filePath, "utf8")));
    return raw.map((value) => researchTopicSchema.parse(JSON.parse(value))).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

export async function refreshTopicArtifacts(topicId: string, cwd?: string): Promise<{ topic: ResearchTopic; corpus: TopicCorpusManifest }> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const topicPaths = getTopicPaths(workspace, topicId);
  const current = await loadTopic(topicId, cwd);
  const [sources, notebookBindings, runs] = await Promise.all([
    loadSourceArtifacts(vault.sourcesDir),
    loadNotebookBindings(vault.notebooksDir),
    loadRunIndexes(vault.runsDir)
  ]);

  const sourceIds = sources.filter((source) => source.topicId === topicId).map((source) => source.id).sort();
  const notebookBindingIds = notebookBindings.filter((binding) => binding.topicId === topicId).map((binding) => binding.id).sort();
  const topicRuns = runs.filter((run) => run.topicId === topicId);
  const runIds = topicRuns.map((run) => run.id).sort();
  const status = deriveTopicStatus({
    sourceCount: sourceIds.length,
    notebookBindingCount: notebookBindingIds.length,
    runs: topicRuns
  });
  const now = new Date().toISOString();

  const topic = researchTopicSchema.parse({
    ...current.topic,
    status,
    updatedAt: now
  });
  const corpus = topicCorpusManifestSchema.parse({
    ...current.corpus,
    sourceIds,
    notebookBindingIds,
    runIds,
    updatedAt: now
  });

  await persistTopicArtifacts(topicPaths, topic, corpus);
  return { topic, corpus };
}

function deriveTopicStatus(input: {
  sourceCount: number;
  notebookBindingCount: number;
  runs: Array<ReturnType<typeof runIndexSchema.parse>>;
}): TopicStatus {
  if (
    input.runs.some(
      (run) =>
        run.completedQuestionIds.length > 0 ||
        run.status === "completed" ||
        run.status === "incomplete"
    )
  ) {
    return "researched";
  }
  if (input.sourceCount > 0 && input.notebookBindingCount > 0) {
    return "ready_for_planning";
  }
  if (input.sourceCount > 0 || input.notebookBindingCount > 0) {
    return "collecting_sources";
  }
  return "initialized";
}

async function persistTopicArtifacts(
  topicPaths: ReturnType<typeof getTopicPaths>,
  topic: ResearchTopic,
  corpus: TopicCorpusManifest
): Promise<void> {
  await mkdir(topicPaths.topicDir, { recursive: true });
  await writeJsonFile(topicPaths.indexJsonPath, topic);
  await writeJsonFile(topicPaths.corpusJsonPath, corpus);
  await writeFile(topicPaths.indexMarkdownPath, buildTopicMarkdown(topic), "utf8");
  await writeFile(topicPaths.corpusMarkdownPath, buildCorpusMarkdown(topic, corpus), "utf8");
}

function buildTopicMarkdown(topic: ResearchTopic): string {
  const title = normalizeObsidianText(topic.name, topic.id);
  return toFrontmatterMarkdown(
    {
      id: topic.id,
      type: "topic",
      title,
      aliases: makeAliases(topic.id),
      tags: makeTags("sourceloop", "research", "topic", topic.status),
      name: title,
      goal: topic.goal,
      intended_output: topic.intendedOutput,
      status: topic.status,
      created_at: topic.createdAt,
      updated_at: topic.updatedAt
    },
    `# ${title}

## Research Goal
${topic.goal ?? "No explicit research goal provided."}

## Intended Output
${topic.intendedOutput ?? "No output hint provided."}

## Status
- ${topic.status}

## Linked Artifacts
- ${toMarkdownLink("Corpus", "./corpus.md")}`
  );
}

function buildCorpusMarkdown(topic: ResearchTopic, corpus: TopicCorpusManifest): string {
  const title = `${normalizeObsidianText(topic.name, topic.id)} Corpus`;
  return toFrontmatterMarkdown(
    {
      id: corpus.id,
      type: "corpus",
      title,
      aliases: makeAliases(corpus.id),
      tags: makeTags("sourceloop", "research", "corpus"),
      topic_id: corpus.topicId,
      source_ids: corpus.sourceIds,
      notebook_binding_ids: corpus.notebookBindingIds,
      run_ids: corpus.runIds,
      created_at: corpus.createdAt,
      updated_at: corpus.updatedAt
    },
    `# ${title}

## Sources
${renderList(corpus.sourceIds, "../../sources", ".md")}

## Notebook Bindings
${renderList(corpus.notebookBindingIds, "../../notebooks", ".md")}

## Runs
${renderList(corpus.runIds, "../../runs", "/index.md")}`
  );
}

function renderList(ids: string[], basePath: string, suffix: string): string {
  if (ids.length === 0) {
    return "- none";
  }

  return ids.map((id) => `- ${toMarkdownLink(id, `${basePath}/${id}${suffix}`)}`).join("\n");
}

function toMarkdownLink(label: string, targetPath: string): string {
  return `[${label}](${targetPath})`;
}

async function loadSourceArtifacts(sourcesDir: string) {
  const files = await readJsonFiles(sourcesDir);
  return files.map((raw) => sourceDocumentSchema.parse(JSON.parse(raw)));
}

async function loadNotebookBindings(notebooksDir: string) {
  const files = await readJsonFiles(notebooksDir);
  return files.map((raw) => notebookBindingSchema.parse(JSON.parse(raw)));
}

async function loadRunIndexes(runsDir: string) {
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const raw = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readFile(path.join(runsDir, entry.name, "index.json"), "utf8"))
    );
    return raw.map((value) => runIndexSchema.parse(JSON.parse(value)));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

async function readJsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory);
    const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
    return Promise.all(jsonFiles.map((entry) => readFile(path.join(directory, entry), "utf8")));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
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
