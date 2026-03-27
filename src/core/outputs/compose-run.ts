import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadNotebookBinding, loadQuestionBatch, loadRunExchanges } from "../runs/load-artifacts.js";
import { buildRunIndexMarkdown } from "../runs/render-run-note.js";
import { getRunPaths } from "../vault/paths.js";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { outputArtifactSchema, runIndexSchema, type OutputArtifact, type QARunIndex } from "../../schemas/run.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { refreshTopicArtifacts } from "../topics/manage-topics.js";
import { loadChromeAttachTarget } from "../attach/manage-targets.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";
import { getExchangeNoteFromArtifact, getOutputNote, getQuestionsNote, getRunIndexNote, getTopicIndexNote, toWikiLink } from "../vault/notes.js";

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
  const { binding } = await loadNotebookBinding(run.notebookBindingId, input.cwd);
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

  const outputNote = getOutputNote(workspace, run, batch.topic, artifact);
  const markdownPath = outputNote.absolutePath;
  const jsonPath = path.join(runPaths.outputsDir, `${input.format}.json`);

  await writeFile(markdownPath, buildOutputMarkdown(workspace, run, batch, artifact, exchanges), "utf8");
  await writeJsonFile(jsonPath, artifact);
  await updateRunOutputs(workspace, runPaths.indexJsonPath, run, batch, binding, artifact.id);
  if (run.topicId) {
    await refreshTopicArtifacts(run.topicId, input.cwd);
  }

  return { artifact, markdownPath };
}

async function updateRunOutputs(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  indexJsonPath: string,
  run: QARunIndex,
  batch: Awaited<ReturnType<typeof loadQuestionBatch>>["batch"],
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"],
  artifactId: string
): Promise<void> {
  const nextRun = runIndexSchema.parse({
    ...run,
    updatedAt: new Date().toISOString(),
    outputArtifacts: [...new Set([...run.outputArtifacts, artifactId])]
  });

  await writeJsonFile(indexJsonPath, nextRun);
  const runNote = getRunIndexNote(workspace, nextRun);
  const attachTarget =
    nextRun.attachedChromeTargetId || binding.attachTargetId
      ? (
          await loadChromeAttachTarget(nextRun.attachedChromeTargetId ?? binding.attachTargetId ?? "", workspace.rootDir).catch(() => undefined)
        )?.target
      : undefined;
  await writeFile(
    runNote.absolutePath,
    buildRunIndexMarkdown({
      workspace,
      run: nextRun,
      batch,
      binding,
      ...(attachTarget ? { attachTarget } : {})
    }),
    "utf8"
  );
}

function buildOutputMarkdown(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  run: QARunIndex,
  batch: Awaited<ReturnType<typeof loadQuestionBatch>>["batch"],
  artifact: OutputArtifact,
  exchanges: Awaited<ReturnType<typeof loadRunExchanges>>
): string {
  const topicTitle = normalizeObsidianText(batch.topic, artifact.id);
  const sections = exchanges.map((exchange) =>
    artifact.format === "brief"
      ? `## ${normalizeObsidianText(exchange.question, exchange.questionId)}\n\n### Summary\n${exchange.answer}\n\n### Support\n- ${toWikiLink(workspace, getExchangeNoteFromArtifact(workspace, exchange).absolutePath, getExchangeNoteFromArtifact(workspace, exchange).title)}`
      : `## ${normalizeObsidianText(exchange.question, exchange.questionId)}\n\n- Key Answer: ${exchange.answer}\n- Evidence: ${toWikiLink(workspace, getExchangeNoteFromArtifact(workspace, exchange).absolutePath, getExchangeNoteFromArtifact(workspace, exchange).title)}`
  );

  return toFrontmatterMarkdown(
    {
      type: "output",
      title: getOutputNote(workspace, run, batch.topic, artifact).title,
      aliases: makeAliases(artifact.id),
      tags: makeTags("sourceloop", "research", "output", artifact.format),
      format: artifact.format,
      ...(artifact.topicId ? { topic: topicTitle } : {}),
      created: artifact.createdAt,
      updated: artifact.createdAt
    },
    `# ${artifact.format === "brief" ? "Brief" : "Outline"}: ${topicTitle}

## Traceability
- Topic: ${
      artifact.topicId
        ? toWikiLink(
            workspace,
            getTopicIndexNote(workspace, {
              id: artifact.topicId,
              type: "research_topic",
              name: batch.topic,
              status: "initialized",
              createdAt: artifact.createdAt,
              updatedAt: artifact.createdAt
            }).absolutePath,
            topicTitle
          )
        : "none"
    }
- Run: ${toWikiLink(workspace, getRunIndexNote(workspace, run).absolutePath, "Run")}
- Questions: ${toWikiLink(workspace, getQuestionsNote(workspace, batch).absolutePath, `${topicTitle} Questions`)}

${sections.join("\n\n")}`
  );
}
