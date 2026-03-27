import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRunPaths } from "../vault/paths.js";
import { loadNotebookBinding, loadQuestionBatch, loadRunExchanges } from "./load-artifacts.js";
import type { NotebookRunnerAdapter } from "../notebooklm/adapter.js";
import type { NotebookRunnerAnswer } from "../notebooklm/adapter.js";
import { qaExchangeSchema, runIndexSchema, type QAExchange, type QARunIndex } from "../../schemas/run.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { loadTopic, refreshTopicArtifacts } from "../topics/manage-topics.js";
import { makeAliases, makeTags, normalizeObsidianText, summarizeQuestionTitle } from "../../lib/obsidian.js";

export type ExecuteQARunInput = {
  runId: string;
  adapter: NotebookRunnerAdapter;
  cwd?: string;
};

export type ExecuteQARunResult = {
  run: QARunIndex;
  completedExchanges: QAExchange[];
};

export async function executeQARun(input: ExecuteQARunInput): Promise<ExecuteQARunResult> {
  const { workspace, batch, run } = await loadQuestionBatch(input.runId, input.cwd);
  const { binding } = await loadNotebookBinding(run.notebookBindingId, input.cwd);
  const runPaths = getRunPaths(workspace, run.id);
  await mkdir(runPaths.exchangesDir, { recursive: true });
  await mkdir(runPaths.outputsDir, { recursive: true });

  const existingExchanges = await loadRunExchanges(run.id, input.cwd);
  const completed = new Map(existingExchanges.map((exchange) => [exchange.questionId, exchange]));
  let currentRun = runIndexSchema.parse({
    ...run,
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
    await persistRunIndex(runPaths.indexJsonPath, runPaths.indexMarkdownPath, currentRun);
    throw error;
  }

  try {
    const executionMetadata = await input.adapter.prepareRun?.(binding);
    currentRun = updateRunStatus(
      runIndexSchema.parse({
        ...currentRun,
        executionMode: executionMetadata?.executionMode ?? currentRun.executionMode,
        attachedChromeTargetId: executionMetadata?.attachedChromeTargetId ?? currentRun.attachedChromeTargetId,
        failureReason: undefined
      }),
      "running"
    );
    await persistRunIndex(runPaths.indexJsonPath, runPaths.indexMarkdownPath, currentRun);
  } catch (error) {
    currentRun = runIndexSchema.parse({
      ...currentRun,
      status: "failed",
      updatedAt: new Date().toISOString(),
      completedQuestionIds: [...completed.keys()],
      failureReason: error instanceof Error ? error.message : String(error)
    });
    await persistRunIndex(runPaths.indexJsonPath, runPaths.indexMarkdownPath, currentRun);
    await input.adapter.dispose?.();
    throw error;
  }

  try {
    for (const question of batch.questions) {
      if (completed.has(question.id)) {
        continue;
      }

      try {
        const answer = await input.adapter.askQuestion(binding, question);
        const exchange = await writeExchangeArtifact({
          runId: run.id,
          runPaths,
          notebookBindingId: binding.id,
          questionId: question.id,
          question: question.prompt,
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
        await persistRunIndex(runPaths.indexJsonPath, runPaths.indexMarkdownPath, currentRun);
      } catch (error) {
        currentRun = runIndexSchema.parse({
          ...currentRun,
          status: "incomplete",
          updatedAt: new Date().toISOString(),
          completedQuestionIds: [...completed.keys()],
          failedQuestionId: question.id,
          failureReason: error instanceof Error ? error.message : String(error)
        });
        await persistRunIndex(runPaths.indexJsonPath, runPaths.indexMarkdownPath, currentRun);
        return {
          run: currentRun,
          completedExchanges: [...completed.values()]
        };
      }
    }

    currentRun = runIndexSchema.parse({
      ...currentRun,
      status: "completed",
      updatedAt: new Date().toISOString(),
      completedQuestionIds: [...completed.keys()],
      failedQuestionId: undefined,
      failureReason: undefined
    });
    await persistRunIndex(runPaths.indexJsonPath, runPaths.indexMarkdownPath, currentRun);
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

  if (corpus.sourceIds.length === 0) {
    throw new Error(`Topic ${run.topicId} has no sources in its corpus. Ingest topic-backed material before running NotebookLM questions.`);
  }
}

function updateRunStatus(run: QARunIndex, status: QARunIndex["status"]): QARunIndex {
  return runIndexSchema.parse({
    ...run,
    status,
    updatedAt: new Date().toISOString()
  });
}

async function persistRunIndex(jsonPath: string, markdownPath: string, run: QARunIndex): Promise<void> {
  await writeJsonFile(jsonPath, run);
  await writeFile(markdownPath, buildRunIndexMarkdown(run), "utf8");
}

async function writeExchangeArtifact(input: {
  runId: string;
  topicId?: string;
  runPaths: ReturnType<typeof getRunPaths>;
  notebookBindingId: string;
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
  await writeJsonFile(`${basePath}.json`, exchange);
  await writeFile(`${basePath}.md`, buildExchangeMarkdown(exchange), "utf8");

  return exchange;
}

function buildRunIndexMarkdown(run: QARunIndex): string {
  const completedExchangeLines =
    run.completedQuestionIds.length === 0
      ? "- none yet"
      : run.completedQuestionIds.map((questionId) => `- ${toMarkdownLink(questionId, `./exchanges/${questionId}.md`)}`).join("\n");
  const topicTitle = normalizeObsidianText(run.topic, run.id);

  return toFrontmatterMarkdown(
    {
      id: run.id,
      type: "run",
      title: `${topicTitle} Run`,
      aliases: makeAliases(run.id),
      tags: makeTags("sourceloop", "research", "run", run.status, run.executionMode),
      topic: topicTitle,
      topic_id: run.topicId,
      notebook_binding_id: run.notebookBindingId,
      question_batch_id: run.questionBatchId,
      status: run.status,
      execution_mode: run.executionMode,
      attached_chrome_target_id: run.attachedChromeTargetId,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
      completed_question_ids: run.completedQuestionIds,
      failed_question_id: run.failedQuestionId,
      failure_reason: run.failureReason,
      output_artifacts: run.outputArtifacts
    },
    `# ${topicTitle} Run

## Run Summary

- Topic: ${topicTitle}
- Topic ID: ${run.topicId ?? "legacy-notebook-first"}
- Topic Artifact: ${run.topicId ? toMarkdownLink(run.topicId, `../../topics/${run.topicId}/index.md`) : "none"}
- Status: ${run.status}
- Notebook Binding: ${toMarkdownLink(run.notebookBindingId, `../../notebooks/${run.notebookBindingId}.md`)}
- Attach Target: ${
        run.attachedChromeTargetId
          ? toMarkdownLink(run.attachedChromeTargetId, `../../chrome-targets/${run.attachedChromeTargetId}.md`)
          : "none"
      }
- Question Batch: ${toMarkdownLink("questions", "./questions.md")}

## Progress

- Completed Questions: ${run.completedQuestionIds.length}
- Failed Question: ${run.failedQuestionId ?? "none"}
- Failure Reason: ${run.failureReason ?? "none"}

## Linked Exchanges
${completedExchangeLines}`
  );
}

function buildExchangeMarkdown(exchange: QAExchange): string {
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
          return `- ${parts.join(" ")}`;
        });

  const title = summarizeQuestionTitle(exchange.question, exchange.questionId);
  return toFrontmatterMarkdown(
    {
      id: exchange.id,
      type: "answer",
      title,
      aliases: makeAliases(exchange.questionId, exchange.id),
      tags: makeTags("sourceloop", "research", "answer", exchange.answerSource),
      run_id: exchange.runId,
      topic_id: exchange.topicId,
      notebook_binding_id: exchange.notebookBindingId,
      question_id: exchange.questionId,
      answer_source: exchange.answerSource,
      created_at: exchange.createdAt
    },
    `# ${title}

## Question
${exchange.question}

## NotebookLM Answer
${exchange.answer}

## Citations
${citationLines.join("\n")}

## Links
- Run: ${toMarkdownLink("Run", "../index.md")}
- Topic Artifact: ${exchange.topicId ? toMarkdownLink(exchange.topicId, `../../../topics/${exchange.topicId}/index.md`) : "none"}
- Question Batch: ${toMarkdownLink("questions", "../questions.md")}
- Notebook Binding: ${toMarkdownLink(exchange.notebookBindingId, `../../../notebooks/${exchange.notebookBindingId}.md`)}`
  );
}

function toMarkdownLink(label: string, targetPath: string): string {
  return `[${label}](${targetPath})`;
}
