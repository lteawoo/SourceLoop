import { Command } from "commander";
import { createQuestionPlan } from "../core/runs/question-planner.js";
import { loadTopic } from "../core/topics/manage-topics.js";

export async function resolvePlanInput(
  topicOrId: string,
  options: { notebook?: string; objective?: string; maxQuestions?: number; families?: string[] }
): Promise<Parameters<typeof createQuestionPlan>[0]> {
  const baseInput = {
    ...(options.notebook ? { notebookBindingId: options.notebook } : {}),
    ...(options.objective ? { objective: options.objective } : {}),
    ...(options.maxQuestions !== undefined ? { maxQuestions: options.maxQuestions } : {}),
    ...(options.families?.length ? { families: options.families } : {})
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
  .option("--families <families>", "comma-separated question families to include", parseCsvList)
  .action(async (topicOrId: string, options: { notebook?: string; objective?: string; maxQuestions?: number; families?: string[] }) => {
    const result = await createQuestionPlan(await resolvePlanInput(topicOrId, options));

    process.stdout.write(`Planned run ${result.run.id} at ${result.runDir}\n`);
  });

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}

function parseCsvList(value: string): string[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error("Expected at least one comma-separated value.");
  }
  return items;
}
