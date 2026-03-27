import type { NotebookBinding } from "../../schemas/notebook.js";
import type { PlannedQuestion, CitationReference } from "../../schemas/run.js";

export type NotebookRunnerAnswer = {
  answer: string;
  citations: CitationReference[];
  answerSource: "notebooklm";
};

export type NotebookRunnerExecutionMetadata = {
  executionMode?: "attached_chrome" | "fixture";
  attachedChromeTargetId?: string;
};

export interface NotebookRunnerAdapter {
  readonly kind: "browser-agent" | "fixture";
  prepareRun?(binding: NotebookBinding): Promise<NotebookRunnerExecutionMetadata | void>;
  askQuestion(binding: NotebookBinding, question: PlannedQuestion): Promise<NotebookRunnerAnswer>;
  dispose?(): Promise<void>;
}
