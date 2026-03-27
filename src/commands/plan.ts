import { Command } from "commander";
import { createQuestionPlan } from "../core/runs/question-planner.js";
import { loadTopic } from "../core/topics/manage-topics.js";

export async function resolvePlanInput(
  topicOrId: string,
  options: { notebook?: string; objective?: string }
): Promise<Parameters<typeof createQuestionPlan>[0]> {
  const baseInput = {
    ...(options.notebook ? { notebookBindingId: options.notebook } : {}),
    ...(options.objective ? { objective: options.objective } : {})
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
  .action(async (topicOrId: string, options: { notebook?: string; objective?: string }) => {
    const result = await createQuestionPlan(await resolvePlanInput(topicOrId, options));

    process.stdout.write(`Planned run ${result.run.id} at ${result.runDir}\n`);
  });
