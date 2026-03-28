import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { getRunPaths } from "../vault/paths.js";
import {
  questionBatchSchema,
  questionKindSchema,
  runIndexSchema,
  type PlannedQuestion,
  type PlanningScope,
  type QARunIndex,
  type QuestionBatch
} from "../../schemas/run.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { slugify } from "../../lib/slugify.js";
import { loadNotebookBinding } from "./load-artifacts.js";
import { listNotebookSourceManifests } from "../notebooks/manage-notebook-source-manifests.js";
import { listManagedNotebookImports } from "../notebooks/manage-managed-notebooks.js";
import { loadTopic, refreshTopicArtifacts } from "../topics/manage-topics.js";
import { loadChromeAttachTarget } from "../attach/manage-targets.js";
import { getVaultPaths } from "../vault/paths.js";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { notebookBindingSchema } from "../../schemas/notebook.js";
import { makeAliases, makeTags, normalizeObsidianText, summarizeQuestionTitle } from "../../lib/obsidian.js";
import { getExchangeNote, getNotebookNote, getQuestionsNote, getRunIndexNote, getTopicIndexNote, toWikiLink } from "../vault/notes.js";
import { buildRunIndexMarkdown } from "./render-run-note.js";

export type CreateQuestionPlanInput = {
  topic?: string;
  topicId?: string;
  notebookBindingId?: string;
  objective?: string;
  maxQuestions?: number;
  families?: string[];
  cwd?: string;
};

export type CreateQuestionPlanResult = {
  run: QARunIndex;
  batch: QuestionBatch;
  runDir: string;
  runMarkdownPath: string;
  questionsMarkdownPath: string;
};

export const DEFAULT_MAX_QUESTIONS = 10;

export async function createQuestionPlan(
  input: CreateQuestionPlanInput
): Promise<CreateQuestionPlanResult> {
  const workspace = await loadWorkspace(input.cwd);
  const topicRecord = input.topicId ? await loadTopic(input.topicId, input.cwd) : undefined;
  const notebookBindingId =
    input.notebookBindingId ??
    (input.topicId ? await resolveNotebookBindingIdForTopic(workspace.rootDir, input.topicId) : undefined);

  if (!notebookBindingId) {
    throw new Error("Question planning requires a notebook binding. For the preferred flow, create a topic-bound notebook and plan by topic id.");
  }

  const { binding } = await loadNotebookBinding(notebookBindingId, input.cwd);
  if (topicRecord) {
    await preflightTopicPlanningContext(topicRecord.corpus, binding, input.cwd);
  }
  const timestamp = new Date();
  const createdAt = timestamp.toISOString();
  const topicName = normalizeObsidianText(topicRecord?.topic.name ?? input.topic ?? binding.topic);
  const objective =
    input.objective ??
    topicRecord?.topic.goal ??
    `Research ${topicName} through a planned NotebookLM Q&A run.`;
  const intendedOutput = topicRecord?.topic.intendedOutput;
  const planningScope = normalizePlanningScope(input.maxQuestions, input.families);
  const questions = buildPlannedQuestions(topicName, objective, intendedOutput, planningScope);
  const questionFamilies = [...new Set(questions.map((question) => question.kind))];
  const runId = buildRunId(topicName, timestamp);

  const batch = questionBatchSchema.parse({
    id: `batch-${runId}`,
    type: "question_batch",
    topic: topicName,
    topicId: topicRecord?.topic.id,
    notebookBindingId,
    objective,
    intendedOutput,
    questionFamilies,
    ...(planningScope ? { planningScope } : {}),
    createdAt,
    questions
  });

  const run = runIndexSchema.parse({
    id: runId,
    type: "qa_run",
    topic: topicName,
    topicId: topicRecord?.topic.id,
    notebookBindingId,
    questionBatchId: batch.id,
    status: "planned",
    ...(planningScope ? { planningScope } : {}),
    createdAt,
    updatedAt: createdAt,
    completedQuestionIds: [],
    outputArtifacts: []
  });

  const runPaths = getRunPaths(workspace, run.id);
  const runNote = getRunIndexNote(workspace, run);
  const questionsNote = getQuestionsNote(workspace, batch);
  const attachTarget = binding.attachTargetId
    ? (await loadChromeAttachTarget(binding.attachTargetId, input.cwd).catch(() => undefined))?.target
    : undefined;
  await mkdir(runPaths.exchangesDir, { recursive: true });
  await mkdir(runPaths.outputsDir, { recursive: true });

  await writeJsonFile(runPaths.indexJsonPath, run);
  await writeJsonFile(runPaths.questionsJsonPath, batch);
  await writeFile(
    runNote.absolutePath,
    buildRunIndexMarkdown({
      workspace,
      run,
      batch,
      binding,
      ...(attachTarget ? { attachTarget } : {})
    }),
    "utf8"
  );
  await writeFile(questionsNote.absolutePath, buildQuestionsMarkdown(workspace, batch, binding), "utf8");
  if (topicRecord?.topic.id) {
    await refreshTopicArtifacts(topicRecord.topic.id, input.cwd);
  }

  return {
    run,
    batch,
    runDir: runPaths.runDir,
    runMarkdownPath: runNote.absolutePath,
    questionsMarkdownPath: questionsNote.absolutePath
  };
}

async function preflightTopicPlanningContext(
  corpus: Awaited<ReturnType<typeof loadTopic>>["corpus"],
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"],
  cwd?: string
) {
  if (binding.topicId && binding.topicId !== corpus.topicId) {
    throw new Error(
      `Notebook binding ${binding.id} belongs to ${binding.topicId}, not topic ${corpus.topicId}.`
    );
  }
  if (!corpus.notebookBindingIds.includes(binding.id)) {
    throw new Error(`Topic ${corpus.topicId} corpus does not include notebook binding ${binding.id}. Refresh or re-bind the notebook.`);
  }

  const notebookSourceManifests = await listNotebookSourceManifests(cwd);
  const matchingNotebookEvidenceCount = notebookSourceManifests.filter(
    (manifest) =>
      corpus.notebookSourceManifestIds.includes(manifest.id) &&
      manifest.notebookBindingId === binding.id
  ).length;
  const managedNotebookImports = await listManagedNotebookImports(cwd);
  const matchingManagedEvidenceCount = managedNotebookImports.filter(
    (managedImport) =>
      corpus.managedNotebookImportIds.includes(managedImport.id) &&
      managedImport.notebookBindingId === binding.id &&
      managedImport.status === "imported"
  ).length;
  const evidenceCount = corpus.sourceIds.length + matchingNotebookEvidenceCount + matchingManagedEvidenceCount;
  if (evidenceCount === 0) {
    throw new Error(
      `Topic ${corpus.topicId} has no declared evidence aligned to notebook binding ${binding.id}. Ingest topic-backed material, declare a notebook-source manifest, or import managed sources for this notebook before planning NotebookLM questions.`
    );
  }
}

function buildRunId(topic: string, timestamp: Date): string {
  const time = timestamp.toISOString().replace(/[:.]/g, "-");
  return `run-${slugify(topic)}-${time}`;
}

export function buildPlannedQuestions(
  topic: string,
  objective: string,
  intendedOutput?: string,
  planningScope?: PlanningScope
): PlannedQuestion[] {
  const prompts = [
    {
      kind: "core",
      objective: `Identify the core concepts and framing for ${topic}.`,
      prompt: `What are the core concepts, scope boundaries, and important definitions for ${topic}?`
    },
    {
      kind: "structure",
      objective: `Map the structure and major segments inside ${topic}.`,
      prompt: `How is ${topic} structured into major segments, layers, or categories, and how do they relate to each other?`
    },
    {
      kind: "deep_dive",
      objective: `Find the major bottlenecks or constraints for ${topic}.`,
      prompt: `What are the most important bottlenecks, constraints, or failure modes within ${topic}?`
    },
    {
      kind: "deep_dive",
      objective: `Identify structural risks or dependency constraints for ${topic}.`,
      prompt: `What dependencies, hidden assumptions, or structural risks most affect outcomes in ${topic}?`
    },
    {
      kind: "comparison",
      objective: `Compare the major alternatives and trade-offs around ${topic}.`,
      prompt: `What are the key alternatives, trade-offs, or contrasting approaches related to ${topic}?`
    },
    {
      kind: "comparison",
      objective: `Distinguish important sub-types or competing schools within ${topic}.`,
      prompt: `Which competing approaches or schools of thought matter most within ${topic}, and when does each approach win or fail?`
    },
    {
      kind: "execution",
      objective: `Extract practical next steps for ${topic}.`,
      prompt: `What practical steps, checklists, or execution guidance should someone follow for ${topic}${intendedOutput ? ` if the goal is ${intendedOutput}` : ""}?`
    },
    {
      kind: "execution",
      objective: `Connect the research topic to the intended human output.`,
      prompt: `If someone wanted to turn ${topic} into ${intendedOutput ?? "a practical output"}, what structure or sequence would make the explanation most useful?`
    },
    {
      kind: "evidence_gap",
      objective: `Expose missing evidence and counterexamples around ${topic}.`,
      prompt: `What evidence is missing, contested, or likely to be overstated in common narratives about ${topic}?`
    },
    {
      kind: "evidence_gap",
      objective: `Identify what would need verification before presenting ${topic} confidently.`,
      prompt: `Which claims about ${topic} would require further verification, counterexamples, or direct source checking before reuse?`
    }
  ] as const;

  const filteredPrompts = prompts.filter((entry) =>
    planningScope?.selectedFamilies?.length ? planningScope.selectedFamilies.includes(entry.kind) : true
  );
  const scopedPrompts =
    planningScope?.maxQuestions !== undefined
      ? filteredPrompts.slice(0, planningScope.maxQuestions)
      : filteredPrompts;

  return scopedPrompts.map((entry, index) => ({
    id: `q${String(index + 1).padStart(2, "0")}-${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      kind: entry.kind,
      prompt: entry.prompt,
      objective: index === 0 ? objective : entry.objective,
      order: index
    }));
}

function normalizePlanningScope(maxQuestions?: number, families?: string[]): PlanningScope | undefined {
  const selectedFamilies = families?.map((family) => questionKindSchema.parse(family));
  const normalizedMaxQuestions = maxQuestions ?? DEFAULT_MAX_QUESTIONS;

  const scope = {
    maxQuestions: normalizedMaxQuestions,
    ...(selectedFamilies && selectedFamilies.length > 0 ? { selectedFamilies } : {})
  };
  return scope;
}

function buildQuestionsMarkdown(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  batch: QuestionBatch,
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"]
): string {
  const runId = batch.id.replace(/^batch-/, "");
  const sections = batch.questions.flatMap((question) => {
    const answerNote = getExchangeNote(workspace, runId, question);
    return [
      `## ${summarizeQuestionTitle(question.prompt, question.id)}`,
      "",
      `- Kind: ${question.kind}`,
      `- Objective: ${question.objective}`,
      `- Answer Note: ${toWikiLink(workspace, answerNote.absolutePath, answerNote.title)}`,
      "",
      question.prompt,
      ""
    ];
  });
  const topicTitle = normalizeObsidianText(batch.topic, batch.id);

  return toFrontmatterMarkdown(
    {
      type: "questions",
      title: `${topicTitle} Questions`,
      aliases: makeAliases(batch.id),
      tags: makeTags("sourceloop", "research", "questions", ...batch.questionFamilies),
      topic: topicTitle,
      objective: batch.objective,
      ...(batch.intendedOutput ? { output: batch.intendedOutput } : {}),
      families: batch.questionFamilies,
      ...(batch.planningScope?.maxQuestions ? { max_questions: String(batch.planningScope.maxQuestions) } : {}),
      ...(batch.planningScope?.selectedFamilies ? { selected_families: batch.planningScope.selectedFamilies } : {}),
      created: batch.createdAt,
      updated: batch.createdAt
    },
    [
      `# ${topicTitle} Questions`,
      "",
      `## Context`,
      `- Topic: ${
        batch.topicId
          ? toWikiLink(
              workspace,
              getTopicIndexNote(workspace, {
                id: batch.topicId,
                type: "research_topic",
                name: batch.topic,
                status: "initialized",
                createdAt: batch.createdAt,
                updatedAt: batch.createdAt
              }).absolutePath,
              topicTitle
            )
          : topicTitle
      }`,
      `- Notebook: ${toWikiLink(workspace, getNotebookNote(workspace, binding).absolutePath, getNotebookNote(workspace, binding).title)}`,
      `- Planning Scope: ${describePlanningScope(batch)}`,
      "",
      ...sections
    ].join("\n")
  );
}

function describePlanningScope(batch: QuestionBatch): string {
  const parts: string[] = [];
  if (batch.planningScope?.maxQuestions !== undefined) {
    parts.push(`max ${batch.planningScope.maxQuestions} questions`);
  }
  if (batch.planningScope?.selectedFamilies?.length) {
    parts.push(`families: ${batch.planningScope.selectedFamilies.join(", ")}`);
  }

  return parts.length > 0 ? parts.join(" | ") : `default planner scope (${DEFAULT_MAX_QUESTIONS} questions)`;
}

async function resolveNotebookBindingIdForTopic(rootDir: string, topicId: string): Promise<string> {
  const workspace = await loadWorkspace(rootDir);
  const vault = getVaultPaths(workspace);
  const entries = await readdir(vault.notebooksDir);
  const notebookFiles = entries.filter((entry) => entry.endsWith(".json"));
  const notebooks = await Promise.all(
    notebookFiles.map(async (entry) => notebookBindingSchema.parse(JSON.parse(await readFile(path.join(vault.notebooksDir, entry), "utf8"))))
  );
  const matches = notebooks.filter((binding) => binding.topicId === topicId);

  if (matches.length === 0) {
    throw new Error(`Topic ${topicId} does not have a bound notebook. Bind a NotebookLM notebook to this topic first.`);
  }

  if (matches.length > 1) {
    throw new Error(`Topic ${topicId} has multiple notebook bindings. Select one explicitly with --notebook.`);
  }

  const [match] = matches;
  if (!match) {
    throw new Error(`Topic ${topicId} does not have a usable notebook binding.`);
  }

  return match.id;
}
