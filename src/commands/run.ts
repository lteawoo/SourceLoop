import { Command } from "commander";
import path from "node:path";
import { executeQARun } from "../core/runs/run-qa.js";
import { FixtureNotebookRunnerAdapter } from "../core/notebooklm/fixture-adapter.js";
import { BrowserAgentNotebookRunnerAdapter } from "../core/notebooklm/browser-agent-adapter.js";
import { loadChromeAttachTarget } from "../core/attach/manage-targets.js";
import { loadNotebookBinding, loadQuestionBatch } from "../core/runs/load-artifacts.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const runCommand = new Command("run")
  .description("Execute a planned NotebookLM Q&A run")
  .argument("<run-id>", "run id to execute")
  .option("--adapter <adapter>", "runner adapter to use", "browser-agent")
  .option("--attach-target <target-id>", "attached Chrome target to use for NotebookLM execution")
  .option("--fixture-file <path>", "fixture response file for local verification")
  .option("--question-id <question-id>", "explicit planned question id to execute", collectCsvValues, [])
  .option("--from-question <question-id>", "start execution from this planned question id")
  .option("--limit <count>", "execute at most this many new questions", parsePositiveInteger)
  .option("--show-browser", "show the browser while the browser-agent adapter runs", false)
  .option("--json", "emit machine-readable JSON", false)
  .action(
    async (
      runId: string,
      options: {
        adapter: "browser-agent" | "fixture";
        attachTarget?: string;
        fixtureFile?: string;
        questionId: string[];
        fromQuestion?: string;
        limit?: number;
        showBrowser: boolean;
        json: boolean;
      }
    ) => {
      if (options.adapter === "fixture" && !options.fixtureFile) {
        throw new Error("--fixture-file is required when --adapter fixture is used.");
      }
      if (options.questionId.length > 0 && options.fromQuestion) {
        throw new Error("--question-id and --from-question cannot be used together.");
      }

      const adapter =
        options.adapter === "fixture"
          ? await FixtureNotebookRunnerAdapter.fromFile(path.resolve(options.fixtureFile ?? ""))
          : await createAttachedBrowserAdapter(runId, options.attachTarget, options.showBrowser);

      const result = await executeQARun({
        runId,
        adapter,
        ...(options.questionId.length ? { questionIds: options.questionId } : {}),
        ...(options.fromQuestion ? { fromQuestionId: options.fromQuestion } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {})
      });

      if (options.json) {
        writeJsonOutput({
          run: result.run,
          completedExchangeIds: result.completedExchanges.map((exchange) => exchange.id),
          completedExchangeCount: result.completedExchanges.length
        });
        return;
      }

      writeTextOutput(`Run ${result.run.id} finished with status ${result.run.status} (${result.completedExchanges.length} exchanges archived)`);
    }
  );

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}

function collectCsvValues(value: string, previous: string[]): string[] {
  return [
    ...previous,
    ...value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  ];
}

async function createAttachedBrowserAdapter(
  runId: string,
  explicitAttachTargetId: string | undefined,
  showBrowser: boolean
) {
  const { run } = await loadQuestionBatch(runId);
  const { binding } = await loadNotebookBinding(run.notebookBindingId);
  const attachTargetId = explicitAttachTargetId ?? binding.attachTargetId;

  if (!attachTargetId) {
    throw new Error(
      `Run ${runId} does not have an attached Chrome target. Re-run with --attach-target <target-id> or bind the notebook with --attach-target.`
    );
  }

  const { target } = await loadChromeAttachTarget(attachTargetId);
  return new BrowserAgentNotebookRunnerAdapter({
    attachTarget: target,
    showBrowser,
    cwd: process.cwd()
  });
}
