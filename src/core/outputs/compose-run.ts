import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadQuestionBatch, loadRunExchanges } from "../runs/load-artifacts.js";
import { getRunPaths } from "../vault/paths.js";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { outputArtifactSchema, runIndexSchema, type OutputArtifact, type QARunIndex } from "../../schemas/run.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { refreshTopicArtifacts } from "../topics/manage-topics.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";

export type ComposeRunInput = {
  runId: string;
  format: "brief" | "outline";
  cwd?: string;
};

export type ComposeRunResult = {
  artifact: OutputArtifact;
  markdownPath: string;
};

export async function composeRun(input: ComposeRunInput): Promise<ComposeRunResult> {
  const workspace = await loadWorkspace(input.cwd);
  const { run, batch } = await loadQuestionBatch(input.runId, input.cwd);
  const archivedExchanges = await loadRunExchanges(input.runId, input.cwd);
  const exchanges = batch.questions
    .map((question) => archivedExchanges.find((exchange) => exchange.questionId === question.id))
    .filter((exchange): exchange is NonNullable<typeof exchange> => Boolean(exchange));

  if (exchanges.length === 0) {
    throw new Error(`Run ${input.runId} has no archived exchanges to compose.`);
  }

  const runPaths = getRunPaths(workspace, input.runId);
  await mkdir(runPaths.outputsDir, { recursive: true });

  const artifact = outputArtifactSchema.parse({
    id: `${run.id}-${input.format}`,
    type: "output_artifact",
    runId: run.id,
    topicId: run.topicId,
    format: input.format,
    createdAt: new Date().toISOString(),
    supportingExchangeIds: exchanges.map((exchange) => exchange.id)
  });

  const markdownPath = path.join(runPaths.outputsDir, `${input.format}.md`);
  const jsonPath = path.join(runPaths.outputsDir, `${input.format}.json`);

  await writeFile(markdownPath, buildOutputMarkdown(run, batch.topic, artifact, exchanges), "utf8");
  await writeJsonFile(jsonPath, artifact);
  await updateRunOutputs(runPaths.indexJsonPath, runPaths.indexMarkdownPath, run, artifact.id);
  if (run.topicId) {
    await refreshTopicArtifacts(run.topicId, input.cwd);
  }

  return { artifact, markdownPath };
}

async function updateRunOutputs(
  indexJsonPath: string,
  indexMarkdownPath: string,
  run: QARunIndex,
  artifactId: string
): Promise<void> {
  const nextRun = runIndexSchema.parse({
    ...run,
    updatedAt: new Date().toISOString(),
    outputArtifacts: [...new Set([...run.outputArtifacts, artifactId])]
  });
  const topicTitle = normalizeObsidianText(nextRun.topic, nextRun.id);

  await writeJsonFile(indexJsonPath, nextRun);
  await writeFile(
    indexMarkdownPath,
    toFrontmatterMarkdown(
      {
        id: nextRun.id,
        type: "run",
        title: `${topicTitle} Run`,
        aliases: makeAliases(nextRun.id),
        tags: makeTags("sourceloop", "research", "run", nextRun.status, nextRun.executionMode),
        topic: topicTitle,
        topic_id: nextRun.topicId,
        notebook_binding_id: nextRun.notebookBindingId,
        question_batch_id: nextRun.questionBatchId,
        status: nextRun.status,
        execution_mode: nextRun.executionMode,
        attached_chrome_target_id: nextRun.attachedChromeTargetId,
        created_at: nextRun.createdAt,
        updated_at: nextRun.updatedAt,
        completed_question_ids: nextRun.completedQuestionIds,
        failed_question_id: nextRun.failedQuestionId,
        failure_reason: nextRun.failureReason,
        output_artifacts: nextRun.outputArtifacts
      },
      `# ${topicTitle} Run

## Run Summary

- Topic: ${topicTitle}
- Topic ID: ${nextRun.topicId ?? "legacy-notebook-first"}
- Topic Artifact: ${nextRun.topicId ? toMarkdownLink(nextRun.topicId, `../../topics/${nextRun.topicId}/index.md`) : "none"}
- Status: ${nextRun.status}
- Notebook Binding: ${toMarkdownLink(nextRun.notebookBindingId, `../../notebooks/${nextRun.notebookBindingId}.md`)}
- Attach Target: ${
        nextRun.attachedChromeTargetId
          ? toMarkdownLink(nextRun.attachedChromeTargetId, `../../chrome-targets/${nextRun.attachedChromeTargetId}.md`)
          : "none"
      }
- Question Batch: ${toMarkdownLink("questions", "./questions.md")}

## Outputs
${nextRun.outputArtifacts
        .map((artifact) =>
          `- ${toMarkdownLink(artifact.replace(`${nextRun.id}-`, ""), `./outputs/${artifact.replace(`${nextRun.id}-`, "")}.md`)}`
        )
        .join("\n")}`
    ),
    "utf8"
  );
}

function buildOutputMarkdown(
  run: QARunIndex,
  topic: string,
  artifact: OutputArtifact,
  exchanges: Awaited<ReturnType<typeof loadRunExchanges>>
): string {
  const topicTitle = normalizeObsidianText(topic, artifact.id);
  const sections = exchanges.map((exchange) =>
    artifact.format === "brief"
      ? `## ${exchange.questionId}\n\n### Summary\n${exchange.answer}\n\n### Support\n- [Exchange](../exchanges/${exchange.questionId}.md)`
      : `## ${exchange.questionId}: ${exchange.question}\n\n- Key Answer: ${exchange.answer}\n- Evidence: [Exchange](../exchanges/${exchange.questionId}.md)`
  );

  return toFrontmatterMarkdown(
    {
      id: artifact.id,
      type: "output",
      title: `${topicTitle} ${artifact.format === "brief" ? "Brief" : "Outline"}`,
      aliases: makeAliases(artifact.id),
      tags: makeTags("sourceloop", "research", "output", artifact.format),
      run_id: run.id,
      topic_id: artifact.topicId,
      format: artifact.format,
      created_at: artifact.createdAt,
      supporting_exchange_ids: artifact.supportingExchangeIds
    },
    `# ${artifact.format === "brief" ? "Brief" : "Outline"}: ${topicTitle}

## Traceability
- Topic Artifact: ${artifact.topicId ? toMarkdownLink(artifact.topicId, `../../topics/${artifact.topicId}/index.md`) : "none"}
- Run: ${toMarkdownLink("Run", "../index.md")}
- Question Batch: ${toMarkdownLink("questions", "../questions.md")}

${sections.join("\n\n")}`
  );
}

function toMarkdownLink(label: string, targetPath: string): string {
  return `[${label}](${targetPath})`;
}
