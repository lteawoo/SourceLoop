import path from "node:path";
import type { ChromeAttachTarget } from "../../schemas/attach.js";
import type { NotebookBinding } from "../../schemas/notebook.js";
import type { OutputArtifact, PlannedQuestion, QAExchange, QARunIndex, QuestionBatch } from "../../schemas/run.js";
import type { SourceDocument } from "../../schemas/source.js";
import type { ResearchTopic } from "../../schemas/topic.js";
import { slugify } from "../../lib/slugify.js";
import { normalizeObsidianText, summarizeQuestionTitle } from "../../lib/obsidian.js";
import { getRunPaths, getTopicPaths, getVaultPaths } from "./paths.js";
import type { LoadedWorkspace } from "../workspace/load-workspace.js";

type NoteIdentity = {
  title: string;
  fileName: string;
  absolutePath: string;
};

function normalizeTitle(title: string, fallback: string): string {
  return normalizeObsidianText(title, fallback);
}

function shortStableSuffix(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toLowerCase() || "note";
}

function readableFileName(title: string, stableValue?: string): string {
  const base = slugify(normalizeTitle(title, "note")) || "note";
  if (!stableValue) {
    return `${base}.md`;
  }

  return `${base}-${shortStableSuffix(stableValue)}.md`;
}

export function getTopicIndexNote(workspace: LoadedWorkspace, topic: ResearchTopic): NoteIdentity {
  const paths = getTopicPaths(workspace, topic.id);
  const title = normalizeTitle(topic.name, topic.id);
  return {
    title,
    fileName: readableFileName(title),
    absolutePath: path.join(paths.topicDir, readableFileName(title))
  };
}

export function getTopicCorpusNote(workspace: LoadedWorkspace, topic: ResearchTopic): NoteIdentity {
  const paths = getTopicPaths(workspace, topic.id);
  const title = `${normalizeTitle(topic.name, topic.id)} Corpus`;
  return {
    title,
    fileName: readableFileName(title),
    absolutePath: path.join(paths.topicDir, readableFileName(title))
  };
}

export function getSourceNote(workspace: LoadedWorkspace, source: SourceDocument): NoteIdentity {
  const vault = getVaultPaths(workspace);
  const title = normalizeTitle(source.title, source.id);
  return {
    title,
    fileName: readableFileName(title, source.id),
    absolutePath: path.join(vault.sourcesDir, readableFileName(title, source.id))
  };
}

export function getNotebookNote(workspace: LoadedWorkspace, binding: NotebookBinding): NoteIdentity {
  const vault = getVaultPaths(workspace);
  const title = normalizeTitle(binding.name, binding.id);
  return {
    title,
    fileName: readableFileName(title, binding.id),
    absolutePath: path.join(vault.notebooksDir, readableFileName(title, binding.id))
  };
}

export function getChromeTargetNote(workspace: LoadedWorkspace, target: ChromeAttachTarget): NoteIdentity {
  const vault = getVaultPaths(workspace);
  const title = normalizeTitle(target.name, target.id);
  return {
    title,
    fileName: readableFileName(title, target.id),
    absolutePath: path.join(vault.chromeTargetsDir, readableFileName(title, target.id))
  };
}

export function getRunIndexNote(workspace: LoadedWorkspace, run: QARunIndex): NoteIdentity {
  const paths = getRunPaths(workspace, run.id);
  const title = `${normalizeTitle(run.topic, run.id)} Run`;
  return {
    title,
    fileName: readableFileName(title),
    absolutePath: path.join(paths.runDir, readableFileName(title))
  };
}

export function getQuestionsNote(workspace: LoadedWorkspace, batch: QuestionBatch): NoteIdentity {
  const paths = getRunPaths(workspace, batch.id.replace(/^batch-/, ""));
  const title = `${normalizeTitle(batch.topic, batch.id)} Questions`;
  return {
    title,
    fileName: readableFileName(title),
    absolutePath: path.join(paths.runDir, readableFileName(title))
  };
}

function questionPrefix(questionId: string): string | undefined {
  return questionId.match(/^q\d+/i)?.[0]?.toLowerCase();
}

export function getQuestionNoteTitle(question: Pick<PlannedQuestion, "prompt" | "id">): string {
  return summarizeQuestionTitle(question.prompt, question.id);
}

export function getExchangeNote(workspace: LoadedWorkspace, runId: string, question: Pick<PlannedQuestion, "prompt" | "id">): NoteIdentity {
  const paths = getRunPaths(workspace, runId);
  const title = getQuestionNoteTitle(question);
  const prefix = questionPrefix(question.id);
  const baseName = prefix ? `${prefix}-${slugify(title)}` : slugify(title);
  const fileName = `${baseName || "answer"}.md`;
  return {
    title,
    fileName,
    absolutePath: path.join(paths.exchangesDir, fileName)
  };
}

export function getExchangeNoteFromArtifact(workspace: LoadedWorkspace, exchange: QAExchange): NoteIdentity {
  return getExchangeNote(workspace, exchange.runId, {
    id: exchange.questionId,
    prompt: exchange.question
  });
}

export function getOutputNote(workspace: LoadedWorkspace, run: QARunIndex, topic: string, artifact: OutputArtifact): NoteIdentity {
  const paths = getRunPaths(workspace, run.id);
  const suffix = artifact.format === "brief" ? "Brief" : "Outline";
  const title = `${normalizeTitle(topic, artifact.id)} ${suffix}`;
  return {
    title,
    fileName: readableFileName(title),
    absolutePath: path.join(paths.outputsDir, readableFileName(title))
  };
}

export function toWikiLink(workspace: LoadedWorkspace, absoluteMarkdownPath: string, label?: string): string {
  const vault = getVaultPaths(workspace);
  const relative = path.relative(vault.vaultRoot, absoluteMarkdownPath).replace(/\\/g, "/").replace(/\.md$/i, "");
  return label ? `[[${relative}|${label}]]` : `[[${relative}]]`;
}
