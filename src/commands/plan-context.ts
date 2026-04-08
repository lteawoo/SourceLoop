import { Command } from "commander";
import { loadTopic } from "../core/topics/manage-topics.js";
import { createQuestionPlanningContext } from "../core/runs/question-planner.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const planContextCommand = new Command("plan-context")
  .description("Export notebook-summary planning context for the active agent session")
  .argument("<topic-or-id>", "topic id for the preferred flow, or a legacy freeform topic string")
  .option("--notebook <binding-id>", "notebook binding id to use for explicit topic notebook selection")
  .option("--objective <objective>", "objective for the research run")
  .option("--max-questions <count>", "cap the number of planned questions", parsePositiveInteger)
  .option("--json", "emit machine-readable JSON", false)
  .addHelpText(
    "after",
    `\nPreferred workflow:\n  sourceloop plan-context <topic-or-id> --json\n  # active agent authors question JSON\n  sourceloop plan <topic-or-id> --questions-file - --json\n`
  )
  .action(
    async (
      topicOrId: string,
      options: {
        notebook?: string;
        objective?: string;
        maxQuestions?: number;
        json: boolean;
      }
    ) => {
      const result = await createQuestionPlanningContext(await resolvePlanContextInput(topicOrId, options));

      if (options.json) {
        writeJsonOutput(result);
        return;
      }

      writeTextOutput(`Planned context for ${result.topic} at notebook ${result.notebookBindingId}`);
    }
  );

async function resolvePlanContextInput(
  topicOrId: string,
  options: {
    notebook?: string;
    objective?: string;
    maxQuestions?: number;
  }
): Promise<Parameters<typeof createQuestionPlanningContext>[0]> {
  const baseInput = {
    ...(options.notebook ? { notebookBindingId: options.notebook } : {}),
    ...(options.objective ? { objective: options.objective } : {}),
    ...(options.maxQuestions !== undefined ? { maxQuestions: options.maxQuestions } : {})
  };

  try {
    const { topic } = await loadTopic(topicOrId);
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

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}
