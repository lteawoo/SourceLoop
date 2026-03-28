import { Command } from "commander";
import { loadChromeAttachTarget } from "../core/attach/manage-targets.js";
import { closeManagedChromeIfOwnedTarget } from "../core/attach/launch-managed-chrome.js";
import { loadNotebookBinding, loadQuestionBatch } from "../core/runs/load-artifacts.js";
import { defaultNotebookBrowserSessionFactory } from "../core/notebooklm/browser-agent.js";
import { importLatestAnswerIntoRun } from "../core/runs/run-qa.js";

export const importLatestCommand = new Command("import-latest")
  .description("Import the latest visible NotebookLM answer into an existing planned run")
  .argument("<run-id>", "run id to import into")
  .option("--question-id <question-id>", "planned question id to attach this imported answer to")
  .option("--attach-target <target-id>", "override the notebook binding attach target")
  .option("--show-browser", "show Chrome while attaching to NotebookLM", false)
  .action(
    async (
      runId: string,
      options: {
        questionId?: string;
        attachTarget?: string;
        showBrowser: boolean;
      }
    ) => {
      const { run } = await loadQuestionBatch(runId);
      const { binding } = await loadNotebookBinding(run.notebookBindingId);
      const attachTargetId = options.attachTarget ?? binding.attachTargetId;

      if (!attachTargetId) {
        throw new Error(
          `Run ${runId} does not have an attached Chrome target. Re-run with --attach-target <target-id> or bind the notebook with --attach-target.`
        );
      }

      const { target } = await loadChromeAttachTarget(attachTargetId);
      const session = await defaultNotebookBrowserSessionFactory.createSession({
        target,
        showBrowser: options.showBrowser,
        reuseExistingNotebookPage: true
      });

      try {
        await session.preflight(binding.notebookUrl);
        const latestAnswer = await session.captureLatestAnswer();
        const result = await importLatestAnswerIntoRun({
          runId,
          answer: {
            ...latestAnswer,
            answerSource: "notebooklm"
          },
          ...(options.questionId ? { questionId: options.questionId } : {})
        });

        process.stdout.write(
          `Imported latest NotebookLM answer into ${result.importedQuestionId} (${result.run.status})\n`
        );
      } finally {
        await session.close();
        await closeManagedChromeIfOwnedTarget({
          target,
          cwd: process.cwd()
        }).catch(() => undefined);
      }
    }
  );
