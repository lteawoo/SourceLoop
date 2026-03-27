import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { getTopicPaths, getVaultPaths } from "../vault/paths.js";
import { getNotebookNote, getRunIndexNote, getSourceNote, getTopicCorpusNote, getTopicIndexNote, toWikiLink } from "../vault/notes.js";
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

  await persistTopicArtifacts(workspace, topicPaths, topic, corpus);
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

  await persistTopicArtifacts(workspace, topicPaths, topic, corpus);
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
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  topicPaths: ReturnType<typeof getTopicPaths>,
  topic: ResearchTopic,
  corpus: TopicCorpusManifest
): Promise<void> {
  const topicNote = getTopicIndexNote(workspace, topic);
  const corpusNote = getTopicCorpusNote(workspace, topic);
  await mkdir(topicPaths.topicDir, { recursive: true });
  await writeJsonFile(topicPaths.indexJsonPath, topic);
  await writeJsonFile(topicPaths.corpusJsonPath, corpus);
  await writeFile(topicNote.absolutePath, buildTopicMarkdown(workspace, topic, corpusNote.absolutePath), "utf8");
  await writeFile(corpusNote.absolutePath, await buildCorpusMarkdown(workspace, topic, corpus), "utf8");
}

function buildTopicMarkdown(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  topic: ResearchTopic,
  corpusNotePath: string
): string {
  const title = normalizeObsidianText(topic.name, topic.id);
  return toFrontmatterMarkdown(
    {
      type: "topic",
      title,
      aliases: makeAliases(topic.id),
      tags: makeTags("sourceloop", "research", "topic", topic.status),
      ...(topic.goal ? { goal: topic.goal } : {}),
      ...(topic.intendedOutput ? { output: topic.intendedOutput } : {}),
      status: topic.status,
      created: topic.createdAt,
      updated: topic.updatedAt
    },
    `# ${title}

## Research Goal
${topic.goal ?? "No explicit research goal provided."}

## Output Hint
${topic.intendedOutput ?? "No output hint provided."}

## Status
- ${topic.status}

## Linked Artifacts
- ${toWikiLink(workspace, corpusNotePath, "Corpus")}`
  );
}

async function buildCorpusMarkdown(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  topic: ResearchTopic,
  corpus: TopicCorpusManifest
): Promise<string> {
  const title = `${normalizeObsidianText(topic.name, topic.id)} Corpus`;
  const vault = getVaultPaths(workspace);
  const [sources, notebooks, runs] = await Promise.all([
    loadSourceArtifacts(vault.sourcesDir),
    loadNotebookBindings(vault.notebooksDir),
    loadRunIndexes(vault.runsDir)
  ]);
  const sourceLinks = corpus.sourceIds
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is (typeof sources)[number] => Boolean(source))
    .map((source) => `- ${toWikiLink(workspace, getSourceNote(workspace, source).absolutePath, normalizeObsidianText(source.title, source.id))}`)
    .join("\n");
  const notebookLinks = corpus.notebookBindingIds
    .map((id) => notebooks.find((binding) => binding.id === id))
    .filter((binding): binding is (typeof notebooks)[number] => Boolean(binding))
    .map((binding) => `- ${toWikiLink(workspace, getNotebookNote(workspace, binding).absolutePath, normalizeObsidianText(binding.name, binding.id))}`)
    .join("\n");
  const runLinks = corpus.runIds
    .map((id) => runs.find((run) => run.id === id))
    .filter((run): run is (typeof runs)[number] => Boolean(run))
    .map((run) => `- ${toWikiLink(workspace, getRunIndexNote(workspace, run).absolutePath, `${normalizeObsidianText(run.topic, run.id)} Run`)}`)
    .join("\n");

  return toFrontmatterMarkdown(
    {
      type: "corpus",
      title,
      aliases: makeAliases(corpus.id),
      tags: makeTags("sourceloop", "research", "corpus"),
      topic: normalizeObsidianText(topic.name, topic.id),
      created: corpus.createdAt,
      updated: corpus.updatedAt
    },
    `# ${title}

## Sources
${sourceLinks || "- none"}

## Notebook Bindings
${notebookLinks || "- none"}

## Runs
${runLinks || "- none"}`
  );
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
