import { Command, InvalidArgumentError } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createQuestionPlan, getQuestionPlannerSetupMessage } from "../core/runs/question-planner.js";
import { loadTopic } from "../core/topics/manage-topics.js";
import { plannedQuestionDraftBundleSchema, plannedQuestionDraftListSchema } from "../schemas/run.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export async function resolvePlanInput(
  topicOrId: string,
  options: { notebook?: string; objective?: string; maxQuestions?: number; questionsFile?: string }
): Promise<Parameters<typeof createQuestionPlan>[0]> {
  const baseInput = {
    ...(options.notebook ? { notebookBindingId: options.notebook } : {}),
    ...(options.objective ? { objective: options.objective } : {}),
    ...(options.maxQuestions !== undefined ? { maxQuestions: options.maxQuestions } : {}),
    ...(options.questionsFile ? { questions: await loadQuestionDrafts(options.questionsFile) } : {}),
    requireAiPlanner: true
  };

  try {
    await loadTopic(topicOrId);
    return {
      topicId: topicOrId,
      ...baseInput
    };
  } catch {
    return {
      topic: topicOrId,
      ...baseInput
    };
  }
}

export const planCommand = new Command("plan")
  .description("Create a deep planned question batch for a topic-backed research run")
  .argument("<topic-or-id>", "topic id for the preferred flow, or a legacy freeform topic string")
  .option("--notebook <binding-id>", "notebook binding id to use for the legacy flow or explicit topic notebook selection")
  .option("--objective <objective>", "objective for the research run")
  .option("--max-questions <count>", "cap the number of planned questions", parsePositiveInteger)
  .option("--questions-file <path>", "JSON file containing AI-generated planned questions, or - to read JSON from stdin")
  .option("--json", "emit machine-readable JSON", false)
  .addHelpText(
    "after",
    `\nPreferred workflow:\n  sourceloop plan-context <topic-or-id> --json\n  # active agent authors question JSON\n  sourceloop plan <topic-or-id> --questions-file - --json\n\nPlanner setup:\n  ${getQuestionPlannerSetupMessage()}\n`
  )
  .action(async (topicOrId: string, options: { notebook?: string; objective?: string; maxQuestions?: number; questionsFile?: string; json: boolean }) => {
    try {
      const result = await createQuestionPlan(await resolvePlanInput(topicOrId, options));

      if (options.json) {
        writeJsonOutput(result);
        return;
      }

      writeTextOutput(`Planned run ${result.run.id} at ${result.runDir}`);
    } catch (error) {
      if (
        options.questionsFile &&
        error instanceof Error &&
        (error instanceof InvalidArgumentError ||
          error.message === "Question planning produced no usable questions after applying the selected planning scope." ||
          error.message === "Question planning requires at least one AI-authored question draft.")
      ) {
        throw new InvalidArgumentError(
          `${error.message} Use sourceloop plan-context --json, author the questions in the active agent session, then pass them back with --questions-file -.`
        );
      }
      throw error;
    }
  });

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}

async function loadQuestionDrafts(filePath: string) {
  if (filePath === "-") {
    return loadQuestionDraftsFromStdin();
  }

  const absolutePath = path.resolve(filePath);
  try {
    const raw = await readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      return plannedQuestionDraftListSchema.parse(parsed);
    }

    return plannedQuestionDraftBundleSchema.parse(parsed).questions;
  } catch (error) {
    if (error instanceof Error) {
      throw new InvalidArgumentError(`Invalid questions file ${absolutePath}: ${error.message}`);
    }
    throw new InvalidArgumentError(`Invalid questions file ${absolutePath}.`);
  }
}

async function loadQuestionDraftsFromStdin() {
  const raw = await readAllStdin();
  if (!raw.trim()) {
    throw new InvalidArgumentError(
      "Invalid questions file -: stdin was empty. Use sourceloop plan-context --json, author the questions in the active agent session, and pipe the question JSON into --questions-file -."
    );
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      return plannedQuestionDraftListSchema.parse(parsed);
    }

    return plannedQuestionDraftBundleSchema.parse(parsed).questions;
  } catch (error) {
    if (error instanceof Error) {
      throw new InvalidArgumentError(
        `Invalid questions file - from stdin: ${error.message}. Use sourceloop plan-context --json, author the questions in the active agent session, then pipe the resulting JSON into --questions-file -.`
      );
    }
    throw new InvalidArgumentError(
      "Invalid questions file - from stdin. Use sourceloop plan-context --json, author the questions in the active agent session, then pipe the resulting JSON into --questions-file -."
    );
  }
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", reject);
  });
}
