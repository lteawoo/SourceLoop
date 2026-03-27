import { readFile } from "node:fs/promises";
import type { NotebookBinding } from "../../schemas/notebook.js";
import type { PlannedQuestion, CitationReference } from "../../schemas/run.js";
import type { NotebookRunnerAdapter, NotebookRunnerAnswer } from "./adapter.js";

type FixtureRecord = Record<
  string,
  {
    answer: string;
    citations?: CitationReference[];
    fail?: boolean;
  }
>;

export class FixtureNotebookRunnerAdapter implements NotebookRunnerAdapter {
  readonly kind = "fixture" as const;

  private constructor(private readonly records: FixtureRecord) {}

  static async fromFile(filePath: string): Promise<FixtureNotebookRunnerAdapter> {
    const raw = await readFile(filePath, "utf8");
    return new FixtureNotebookRunnerAdapter(JSON.parse(raw) as FixtureRecord);
  }

  async prepareRun() {
    return {
      executionMode: "fixture" as const
    };
  }

  async askQuestion(_binding: NotebookBinding, question: PlannedQuestion): Promise<NotebookRunnerAnswer> {
    const record = this.records[question.id];

    if (!record) {
      throw new Error(`No fixture response found for question ${question.id}`);
    }

    if (record.fail) {
      throw new Error(`Fixture requested failure for question ${question.id}`);
    }

    return {
      answer: record.answer,
      citations: record.citations ?? [],
      answerSource: "notebooklm"
    };
  }
}
