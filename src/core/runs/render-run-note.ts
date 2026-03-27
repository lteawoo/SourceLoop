import type { ChromeAttachTarget } from "../../schemas/attach.js";
import type { NotebookBinding } from "../../schemas/notebook.js";
import type { QARunIndex, QuestionBatch } from "../../schemas/run.js";
import type { LoadedWorkspace } from "../workspace/load-workspace.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";
import {
  getChromeTargetNote,
  getExchangeNote,
  getNotebookNote,
  getOutputNote,
  getQuestionsNote,
  getTopicIndexNote,
  toWikiLink
} from "../vault/notes.js";

type BuildRunIndexMarkdownInput = {
  workspace: LoadedWorkspace;
  run: QARunIndex;
  batch: QuestionBatch;
  binding: NotebookBinding;
  attachTarget?: ChromeAttachTarget;
};

export function buildRunIndexMarkdown(input: BuildRunIndexMarkdownInput): string {
  const { workspace, run, batch, binding, attachTarget } = input;
  const topicTitle = normalizeObsidianText(run.topic, run.id);
  const notebookNote = getNotebookNote(workspace, binding);
  const questionsNote = getQuestionsNote(workspace, batch);
  const completedExchangeLines =
    run.completedQuestionIds.length === 0
      ? "- none yet"
      : batch.questions
          .filter((question) => run.completedQuestionIds.includes(question.id))
          .map((question) => {
            const note = getExchangeNote(workspace, run.id, question);
            return `- ${toWikiLink(workspace, note.absolutePath, note.title)}`;
          })
          .join("\n");
  const outputLines =
    run.outputArtifacts.length === 0
      ? "- none yet"
      : run.outputArtifacts
          .map((artifactId) => {
            const format = artifactId.replace(`${run.id}-`, "");
            const note = getOutputNote(workspace, run, batch.topic, {
              id: artifactId,
              type: "output_artifact",
              runId: run.id,
              topicId: run.topicId,
              format: format === "outline" ? "outline" : "brief",
              createdAt: run.updatedAt,
              supportingExchangeIds: []
            });
            return `- ${toWikiLink(workspace, note.absolutePath, note.title)}`;
          })
          .join("\n");
  const attachTargetLine = attachTarget
    ? toWikiLink(workspace, getChromeTargetNote(workspace, attachTarget).absolutePath, normalizeObsidianText(attachTarget.name, attachTarget.id))
    : run.attachedChromeTargetId ?? binding.attachTargetId ?? "none";

  return toFrontmatterMarkdown(
    {
      type: "run",
      title: `${topicTitle} Run`,
      aliases: makeAliases(run.id),
      tags: makeTags("sourceloop", "research", "run", run.status, run.executionMode),
      topic: topicTitle,
      status: run.status,
      ...(run.executionMode ? { mode: run.executionMode } : {}),
      created: run.createdAt,
      updated: run.updatedAt
    },
    `# ${topicTitle} Run

## Run Summary

- Topic: ${
      run.topicId
        ? toWikiLink(
            workspace,
            getTopicIndexNote(workspace, {
              id: run.topicId,
              type: "research_topic",
              name: run.topic,
              status: "initialized",
              createdAt: run.createdAt,
              updatedAt: run.updatedAt
            }).absolutePath,
            topicTitle
          )
        : topicTitle
    }
- Status: ${run.status}
- Notebook: ${toWikiLink(workspace, notebookNote.absolutePath, notebookNote.title)}
- Attach Target: ${attachTargetLine}
- Questions: ${toWikiLink(workspace, questionsNote.absolutePath, questionsNote.title)}

## Progress

- Completed Questions: ${run.completedQuestionIds.length}
- Failed Question: ${run.failedQuestionId ?? "none"}
- Failure Reason: ${run.failureReason ?? "none"}

## Linked Exchanges
${completedExchangeLines}

## Outputs
${outputLines}`
  );
}
