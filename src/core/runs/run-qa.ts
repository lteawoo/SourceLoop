import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRunPaths } from "../vault/paths.js";
import { loadNotebookBinding, loadQuestionBatch, loadRunExchanges } from "./load-artifacts.js";
import type { NotebookRunnerAdapter } from "../notebooklm/adapter.js";
import type { NotebookRunnerAnswer } from "../notebooklm/adapter.js";
import {
  executionScopeSchema,
  qaExchangeSchema,
  runIndexSchema,
  type ExecutionScope,
  type QAExchange,
  type QARunIndex,
  type QuestionBatch
} from "../../schemas/run.js";
import { isLikelyNotebookLMPlaceholderAnswerText } from "../notebooklm/response-extraction.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { loadTopic, refreshTopicArtifacts } from "../topics/manage-topics.js";
import { loadChromeAttachTarget } from "../attach/manage-targets.js";
import { listNotebookSourceManifests } from "../notebooks/manage-notebook-source-manifests.js";
import { listManagedNotebookImports } from "../notebooks/manage-managed-notebooks.js";
import { makeAliases, makeTags, normalizeObsidianText, summarizeQuestionTitle } from "../../lib/obsidian.js";
import { getExchangeNoteFromArtifact, getNotebookNote, getQuestionsNote, getRunIndexNote, getTopicIndexNote, toWikiLink } from "../vault/notes.js";
import { buildRunIndexMarkdown } from "./render-run-note.js";

export type ExecuteQARunInput = {
  runId: string;
  adapter: NotebookRunnerAdapter;
  questionIds?: string[];
  fromQuestionId?: string;
  limit?: number;
  cwd?: string;
};

export type ExecuteQARunResult = {
  run: QARunIndex;
  completedExchanges: QAExchange[];
};

export type ImportLatestAnswerIntoRunInput = {
  runId: string;
  answer: NotebookRunnerAnswer;
  questionId?: string;
  cwd?: string;
};

export type ImportLatestAnswerIntoRunResult = {
  run: QARunIndex;
  exchange: QAExchange;
  importedQuestionId: string;
};

export async function executeQARun(input: ExecuteQARunInput): Promise<ExecuteQARunResult> {
  const { workspace, batch, run } = await loadQuestionBatch(input.runId, input.cwd);
  const { binding } = await loadNotebookBinding(run.notebookBindingId, input.cwd);
  const runPaths = getRunPaths(workspace, run.id);
  await mkdir(runPaths.exchangesDir, { recursive: true });
  await mkdir(runPaths.outputsDir, { recursive: true });

  const existingExchanges = await loadRunExchanges(run.id, input.cwd);
  const completed = new Map(existingExchanges.map((exchange) => [exchange.questionId, exchange]));
  const executionScope = normalizeExecutionScope(input);
  const questionsToExecute = resolveQuestionsToExecute(batch, completed, executionScope);
  let currentRun = runIndexSchema.parse({
    ...run,
    executionScope,
    completedQuestionIds: [...new Set([...run.completedQuestionIds, ...completed.keys()])]
  });

  try {
    await preflightTopicContext(run, binding, input.cwd);
  } catch (error) {
    currentRun = runIndexSchema.parse({
      ...currentRun,
      status: "failed",
      updatedAt: new Date().toISOString(),
      completedQuestionIds: [...completed.keys()],
      failureReason: error instanceof Error ? error.message : String(error)
    });
    await persistRunIndex(workspace, runPaths.indexJsonPath, currentRun, batch, binding);
    throw error;
  }

  try {
    const executionMetadata = await input.adapter.prepareRun?.(binding);
    currentRun = updateRunStatus(
      runIndexSchema.parse({
        ...currentRun,
        executionMode: executionMetadata?.executionMode ?? currentRun.executionMode,
        attachedChromeTargetId: executionMetadata?.attachedChromeTargetId ?? currentRun.attachedChromeTargetId,
        executionScope,
        failureReason: undefined
      }),
      "running"
    );
    await persistRunIndex(workspace, runPaths.indexJsonPath, currentRun, batch, binding);
  } catch (error) {
    currentRun = runIndexSchema.parse({
      ...currentRun,
      status: "failed",
      updatedAt: new Date().toISOString(),
      completedQuestionIds: [...completed.keys()],
      failureReason: error instanceof Error ? error.message : String(error)
    });
    await persistRunIndex(workspace, runPaths.indexJsonPath, currentRun, batch, binding);
    await input.adapter.dispose?.();
    throw error;
  }

  try {
    for (const question of questionsToExecute) {
      try {
        const answer = await input.adapter.askQuestion(binding, question);
        assertNotebookLMAnswerIsMeaningful(answer.answer, question.id);
        const exchange = await writeExchangeArtifact({
          workspace,
          runId: run.id,
          runPaths,
          notebookBindingId: binding.id,
          notebookName: binding.name,
          questionId: question.id,
          question: question.prompt,
          topicName: run.topic,
          batch,
          answer,
          ...(run.topicId ? { topicId: run.topicId } : {})
        });
        completed.set(question.id, exchange);
        currentRun = runIndexSchema.parse({
          ...currentRun,
          status: "running",
          updatedAt: new Date().toISOString(),
          completedQuestionIds: [...completed.keys()],
          failedQuestionId: undefined,
          failureReason: undefined
        });
        await persistRunIndex(workspace, runPaths.indexJsonPath, currentRun, batch, binding);
      } catch (error) {
        currentRun = runIndexSchema.parse({
          ...currentRun,
          status: "incomplete",
          updatedAt: new Date().toISOString(),
          completedQuestionIds: [...completed.keys()],
          failedQuestionId: question.id,
          failureReason: error instanceof Error ? error.message : String(error)
        });
        await persistRunIndex(workspace, runPaths.indexJsonPath, currentRun, batch, binding);
        return {
          run: currentRun,
          completedExchanges: [...completed.values()]
        };
      }
    }

    const allQuestionsCompleted = batch.questions.every((plannedQuestion) => completed.has(plannedQuestion.id));
    currentRun = runIndexSchema.parse({
      ...currentRun,
      status: allQuestionsCompleted ? "completed" : "running",
      updatedAt: new Date().toISOString(),
      completedQuestionIds: [...completed.keys()],
      failedQuestionId: undefined,
      failureReason: undefined
    });
    await persistRunIndex(workspace, runPaths.indexJsonPath, currentRun, batch, binding);
    if (currentRun.topicId) {
      await refreshTopicArtifacts(currentRun.topicId, input.cwd);
    }

    return {
      run: currentRun,
      completedExchanges: [...completed.values()]
    };
  } finally {
    if (currentRun.topicId) {
      await refreshTopicArtifacts(currentRun.topicId, input.cwd);
    }
    await input.adapter.dispose?.();
  }
}

export async function importLatestAnswerIntoRun(
  input: ImportLatestAnswerIntoRunInput
): Promise<ImportLatestAnswerIntoRunResult> {
  const { workspace, batch, run } = await loadQuestionBatch(input.runId, input.cwd);
  const { binding } = await loadNotebookBinding(run.notebookBindingId, input.cwd);
  const runPaths = getRunPaths(workspace, run.id);
  await mkdir(runPaths.exchangesDir, { recursive: true });
  await mkdir(runPaths.outputsDir, { recursive: true });

  const existingExchanges = await loadRunExchanges(run.id, input.cwd);
  const completed = new Map(existingExchanges.map((exchange) => [exchange.questionId, exchange]));

  const question = resolveImportQuestion(batch, completed, input.questionId);
  assertNotebookLMAnswerIsMeaningful(input.answer.answer, question.id);
  const exchange = await writeExchangeArtifact({
    workspace,
    runId: run.id,
    runPaths,
    notebookBindingId: binding.id,
    notebookName: binding.name,
    questionId: question.id,
    question: question.prompt,
    topicName: run.topic,
    batch,
    answer: input.answer,
    ...(run.topicId ? { topicId: run.topicId } : {})
  });

  completed.set(question.id, exchange);
  const allQuestionsCompleted = batch.questions.every((plannedQuestion) => completed.has(plannedQuestion.id));
  const updatedRun = runIndexSchema.parse({
    ...run,
    status: allQuestionsCompleted ? "completed" : "running",
    updatedAt: new Date().toISOString(),
    completedQuestionIds: [...completed.keys()],
    failedQuestionId: undefined,
    failureReason: undefined
  });

  await persistRunIndex(workspace, runPaths.indexJsonPath, updatedRun, batch, binding);
  if (updatedRun.topicId) {
    await refreshTopicArtifacts(updatedRun.topicId, input.cwd);
  }

  return {
    run: updatedRun,
    exchange,
    importedQuestionId: question.id
  };
}

function assertNotebookLMAnswerIsMeaningful(answerText: string, questionId: string): void {
  if (isLikelyNotebookLMPlaceholderAnswerText(answerText)) {
    throw new Error(`NotebookLM returned a loading placeholder for question ${questionId}: ${answerText}`);
  }
}

async function preflightTopicContext(
  run: QARunIndex,
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"],
  cwd?: string
): Promise<void> {
  if (!run.topicId) {
    return;
  }

  const { corpus } = await loadTopic(run.topicId, cwd);

  if (binding.topicId !== run.topicId) {
    throw new Error(
      `Run ${run.id} targets topic ${run.topicId}, but notebook binding ${binding.id} is attached to ${binding.topicId ?? "legacy-notebook-first"}.`
    );
  }

  if (!corpus.notebookBindingIds.includes(binding.id)) {
    throw new Error(`Topic ${run.topicId} corpus does not include notebook binding ${binding.id}. Refresh or re-bind the notebook.`);
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
      `Topic ${run.topicId} has no declared evidence aligned to notebook binding ${binding.id}. Ingest topic-backed material, declare a notebook-source manifest, or import managed sources for this notebook before running NotebookLM questions.`
    );
  }
}

function updateRunStatus(run: QARunIndex, status: QARunIndex["status"]): QARunIndex {
  return runIndexSchema.parse({
    ...run,
    status,
    updatedAt: new Date().toISOString()
  });
}

function normalizeExecutionScope(input: ExecuteQARunInput): ExecutionScope | undefined {
  if (!input.questionIds?.length && !input.fromQuestionId && input.limit === undefined) {
    return undefined;
  }

  return executionScopeSchema.parse({
    ...(input.questionIds?.length ? { questionIds: [...new Set(input.questionIds)] } : {}),
    ...(input.fromQuestionId ? { fromQuestionId: input.fromQuestionId } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {})
  });
}

function resolveQuestionsToExecute(
  batch: QuestionBatch,
  completed: Map<string, QAExchange>,
  executionScope?: ExecutionScope
) {
  const explicitIds = executionScope?.questionIds;
  if (explicitIds?.length) {
    const byId = new Map(batch.questions.map((question) => [question.id, question]));
    const resolved = explicitIds.map((questionId) => {
      const question = byId.get(questionId);
      if (!question) {
        throw new Error(`Question ${questionId} does not exist in run ${batch.id}.`);
      }
      if (completed.has(questionId)) {
        throw new Error(`Question ${questionId} already has an archived answer. Replay is not supported yet.`);
      }
      return question;
    });
    return executionScope?.limit !== undefined ? resolved.slice(0, executionScope.limit) : resolved;
  }

  const startIndex = executionScope?.fromQuestionId
    ? batch.questions.findIndex((question) => question.id === executionScope.fromQuestionId)
    : 0;
  if (executionScope?.fromQuestionId && startIndex === -1) {
    throw new Error(`Question ${executionScope.fromQuestionId} does not exist in run ${batch.id}.`);
  }

  const remaining = batch.questions
    .slice(startIndex)
    .filter((question) => !completed.has(question.id));
  return executionScope?.limit !== undefined ? remaining.slice(0, executionScope.limit) : remaining;
}

function resolveImportQuestion(
  batch: QuestionBatch,
  completed: Map<string, QAExchange>,
  explicitQuestionId?: string
) {
  if (explicitQuestionId) {
    const explicitQuestion = batch.questions.find((question) => question.id === explicitQuestionId);
    if (!explicitQuestion) {
      throw new Error(`Question ${explicitQuestionId} does not exist in run ${batch.id}.`);
    }
    return explicitQuestion;
  }

  const nextQuestion = batch.questions.find((question) => !completed.has(question.id));
  if (!nextQuestion) {
    throw new Error(`Run ${batch.id} already has archived answers for every planned question. Use --question-id to overwrite is not supported.`);
  }

  return nextQuestion;
}

async function persistRunIndex(
  workspace: Awaited<ReturnType<typeof loadTopic>>["workspace"],
  jsonPath: string,
  run: QARunIndex,
  batch: QuestionBatch,
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"]
): Promise<void> {
  await writeJsonFile(jsonPath, run);
  const note = getRunIndexNote(workspace, run);
  const attachTargetId = run.attachedChromeTargetId ?? binding.attachTargetId;
  const attachTarget = attachTargetId
    ? (await loadChromeAttachTarget(attachTargetId, workspace.rootDir).catch(() => undefined))?.target
    : undefined;
  await writeFile(
    note.absolutePath,
    buildRunIndexMarkdown({
      workspace,
      run,
      batch,
      binding,
      ...(attachTarget ? { attachTarget } : {})
    }),
    "utf8"
  );
}

async function writeExchangeArtifact(input: {
  workspace: Awaited<ReturnType<typeof loadTopic>>["workspace"];
  runId: string;
  topicId?: string;
  topicName: string;
  runPaths: ReturnType<typeof getRunPaths>;
  notebookBindingId: string;
  notebookName: string;
  batch: QuestionBatch;
  questionId: string;
  question: string;
  answer: NotebookRunnerAnswer;
}): Promise<QAExchange> {
  const createdAt = new Date().toISOString();
  const exchange = qaExchangeSchema.parse({
    id: `${input.runId}-${input.questionId}`,
    type: "qa_exchange",
    runId: input.runId,
    topicId: input.topicId,
    notebookBindingId: input.notebookBindingId,
    questionId: input.questionId,
    question: input.question,
    answer: input.answer.answer,
    citations: input.answer.citations,
    createdAt,
    answerSource: input.answer.answerSource
  });

  const basePath = path.join(input.runPaths.exchangesDir, exchange.questionId);
  const note = getExchangeNoteFromArtifact(input.workspace, exchange);
  await writeJsonFile(`${basePath}.json`, exchange);
  await writeFile(
    note.absolutePath,
    buildExchangeMarkdown(input.workspace, exchange, input.topicName, input.batch, input.notebookName),
    "utf8"
  );

  return exchange;
}

function buildExchangeMarkdown(
  workspace: Awaited<ReturnType<typeof loadTopic>>["workspace"],
  exchange: QAExchange,
  topicName: string,
  batch: QuestionBatch,
  notebookName: string
): string {
  const linkedAnswer = linkCitationAnchors(exchange.answer);
  const citationLines =
    exchange.citations.length === 0
      ? ["- No citations captured"]
      : exchange.citations.map((citation) => {
          const parts = [citation.label];
          if (citation.sourcePath) {
            parts.push(`(${citation.sourcePath})`);
          } else if (citation.href) {
            parts.push(`(${citation.href})`);
          }
          if (citation.note) {
            parts.push(`- ${citation.note}`);
          }
          return `- ${parts.join(" ")} ^citation-${citation.label}`;
        });

  const title = summarizeQuestionTitle(exchange.question, exchange.questionId);
  return toFrontmatterMarkdown(
    {
      type: "answer",
      title,
      aliases: makeAliases(exchange.questionId, exchange.id),
      tags: makeTags("sourceloop", "research", "answer", exchange.answerSource),
      ...(exchange.topicId ? { topic: topicName } : {}),
      question_id: exchange.questionId,
      answer_source: exchange.answerSource,
      created: exchange.createdAt,
      updated: exchange.createdAt
    },
    `# ${title}

## Question
${exchange.question}

## NotebookLM Answer
${linkedAnswer}

## Citations
${citationLines.join("\n")}

## Links
- Run: ${toWikiLink(
      workspace,
      getRunIndexNote(workspace, {
        id: exchange.runId,
        type: "qa_run",
        topic: topicName,
        ...(exchange.topicId ? { topicId: exchange.topicId } : {}),
        notebookBindingId: exchange.notebookBindingId,
        questionBatchId: `batch-${exchange.runId}`,
        status: "completed",
        createdAt: exchange.createdAt,
        updatedAt: exchange.createdAt,
        completedQuestionIds: [],
        outputArtifacts: []
      }).absolutePath,
      "Run"
    )}
- Topic: ${
      exchange.topicId
        ? toWikiLink(
            workspace,
            getTopicIndexNote(workspace, {
              id: exchange.topicId,
              type: "research_topic",
              name: topicName,
              status: "initialized",
              createdAt: exchange.createdAt,
              updatedAt: exchange.createdAt
            }).absolutePath,
            topicName
          )
        : "none"
    }
- Questions: ${toWikiLink(
      workspace,
      getQuestionsNote(workspace, {
        id: `batch-${exchange.runId}`,
        type: "question_batch",
        topic: topicName,
        ...(exchange.topicId ? { topicId: exchange.topicId } : {}),
        notebookBindingId: exchange.notebookBindingId,
        objective: exchange.question,
        createdAt: exchange.createdAt,
        questionFamilies: [],
        questions: batch.questions
      }).absolutePath,
      "Questions"
    )}
- Notebook: ${toWikiLink(
      workspace,
      getNotebookNote(workspace, {
        id: exchange.notebookBindingId,
        type: "notebook_binding",
        name: notebookName,
        topic: topicName,
        notebookUrl: "",
        accessMode: "owner",
        topics: [],
        createdAt: exchange.createdAt
      }).absolutePath,
      notebookName
    )}`
  );
}

function linkCitationAnchors(answer: string): string {
  return answer.replace(/\[(\d+)\]/g, (match, label: string, offset: number, source: string) => {
    const linked = `[[#^citation-${label}|[${label}]]]`;
    if (offset === 0) {
      return linked;
    }

    const previousChar = source[offset - 1] ?? "";
    if (/\s/.test(previousChar)) {
      return linked;
    }

    return ` ${linked}`;
  });
}
