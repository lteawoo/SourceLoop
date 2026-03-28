import type { ChromeAttachTarget } from "../../schemas/attach.js";
import type { NotebookBinding } from "../../schemas/notebook.js";
import type { PlannedQuestion } from "../../schemas/run.js";
import type { NotebookRunnerAdapter, NotebookRunnerAnswer } from "./adapter.js";
import { closeManagedChromeIfOwnedTarget } from "../attach/launch-managed-chrome.js";
import {
  defaultNotebookBrowserSessionFactory,
  type NotebookBrowserSession,
  type NotebookBrowserSessionFactory
} from "./browser-agent.js";

export class BrowserAgentNotebookRunnerAdapter implements NotebookRunnerAdapter {
  readonly kind = "browser-agent" as const;
  private session: NotebookBrowserSession | undefined;

  constructor(
    private readonly options: {
      attachTarget: ChromeAttachTarget;
      showBrowser?: boolean;
      cwd?: string;
      closeManagedChrome?: typeof closeManagedChromeIfOwnedTarget;
      sessionFactory?: NotebookBrowserSessionFactory;
    }
  ) {}

  async prepareRun(binding: NotebookBinding) {
    const sessionFactory = this.options.sessionFactory ?? defaultNotebookBrowserSessionFactory;
    this.session = await sessionFactory.createSession({
      target: this.options.attachTarget,
      ...(this.options.showBrowser !== undefined ? { showBrowser: this.options.showBrowser } : {})
    });
    await this.session.preflight(binding.notebookUrl);

    return {
      executionMode: "attached_chrome" as const,
      attachedChromeTargetId: this.options.attachTarget.id
    };
  }

  async askQuestion(binding: NotebookBinding, question: PlannedQuestion): Promise<NotebookRunnerAnswer> {
    if (!this.session) {
      throw new Error("Browser-agent adapter has no attached NotebookLM session. Call prepareRun() first.");
    }

    const response = await this.session.askQuestion(question);

    return {
      answer: response.answer,
      citations: response.citations,
      answerSource: "notebooklm"
    };
  }

  async dispose(): Promise<void> {
    await this.session?.close();
    this.session = undefined;
    const closeManagedChrome = this.options.closeManagedChrome ?? closeManagedChromeIfOwnedTarget;
    await closeManagedChrome(
      {
        target: this.options.attachTarget,
        ...(this.options.cwd ? { cwd: this.options.cwd } : {})
      }
    ).catch(() => undefined);
  }
}
