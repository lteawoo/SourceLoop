import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { sourceDocumentSchema, type SourceDocument } from "../../schemas/source.js";
import { htmlToMarkdown } from "./html-to-markdown.js";
import { toFrontmatterMarkdown } from "./frontmatter.js";
import { loadTopic, refreshTopicArtifacts } from "../topics/manage-topics.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";

export type IngestSourceInput = {
  input: string;
  topicId?: string;
  cwd?: string;
};

export type IngestSourceResult = {
  source: SourceDocument;
  outputPath: string;
};

export async function ingestSource(input: IngestSourceInput): Promise<IngestSourceResult> {
  const cwd = input.cwd ?? process.cwd();
  const workspace = await loadWorkspace(cwd);
  const now = new Date().toISOString();
  if (input.topicId) {
    await loadTopic(input.topicId, cwd);
  }

  if (isUrl(input.input)) {
    const source = await ingestUrl(input.input, now, input.topicId);
    const outputPath = await writeSourceArtifact(workspace.rootDir, source);
    if (input.topicId) {
      await refreshTopicArtifacts(input.topicId, cwd);
    }
    return { source, outputPath };
  }

  const source = await ingestFile(input.input, cwd, now, input.topicId);
  const outputPath = await writeSourceArtifact(workspace.rootDir, source);
  if (input.topicId) {
    await refreshTopicArtifacts(input.topicId, cwd);
  }
  return { source, outputPath };
}

type DraftSource = SourceDocument & {
  body: string;
};

async function ingestFile(inputPath: string, cwd: string, capturedAt: string, topicId?: string): Promise<DraftSource> {
  const absolutePath = path.resolve(cwd, inputPath);
  const content = await readFile(absolutePath, "utf8");
  const title = normalizeObsidianText(path.basename(absolutePath, path.extname(absolutePath)));

  return {
    id: createSourceId(),
    type: "file",
    sourceUri: absolutePath,
    title,
    topicId,
    capturedAt,
    topicTags: [],
    body: `# ${title}\n\n${content.trim()}`
  };
}

async function ingestUrl(inputUrl: string, capturedAt: string, topicId?: string): Promise<DraftSource> {
  const response = await fetch(inputUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${inputUrl}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const converted = htmlToMarkdown(html);

  return {
    id: createSourceId(),
    type: "url",
    sourceUri: inputUrl,
    title: normalizeObsidianText(converted.title, inputUrl),
    topicId,
    capturedAt,
    topicTags: [],
    language: converted.language,
    body: converted.body
  };
}

async function writeSourceArtifact(workspaceRoot: string, draft: DraftSource): Promise<string> {
  const source = sourceDocumentSchema.parse({
    id: draft.id,
    type: draft.type,
    sourceUri: draft.sourceUri,
    title: draft.title,
    topicId: draft.topicId,
    author: draft.author,
    capturedAt: draft.capturedAt,
    topicTags: draft.topicTags,
    language: draft.language
  });

  const markdown = toFrontmatterMarkdown(
    {
      id: source.id,
      type: "source",
      title: normalizeObsidianText(source.title, source.id),
      aliases: makeAliases(source.id),
      tags: makeTags("sourceloop", "source", source.type),
      source_uri: source.sourceUri,
      topic_id: source.topicId,
      author: source.author,
      captured_at: source.capturedAt,
      topic_tags: source.topicTags,
      language: source.language
    },
    draft.body
  );

  const sourcesDir = path.join(workspaceRoot, "vault/sources");
  await mkdir(sourcesDir, { recursive: true });
  const markdownPath = path.join(sourcesDir, `${source.id}.md`);
  const jsonPath = path.join(sourcesDir, `${source.id}.json`);
  await writeFile(markdownPath, markdown, "utf8");
  await writeJsonFile(jsonPath, source);

  return markdownPath;
}

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function createSourceId(): string {
  return `src_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
