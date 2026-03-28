import { Command } from "commander";
import { createTopic, listTopics, loadTopic } from "../core/topics/manage-topics.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const topicCommand = new Command("topic").description("Create and inspect topic-first research roots");

topicCommand
  .command("create")
  .description("Create a research topic root")
  .requiredOption("--name <name>", "topic display name")
  .option("--goal <goal>", "optional research goal for this topic")
  .option("--output <output>", "optional output hint, for example lecture, brief, or playbook")
  .option("--force", "overwrite an existing topic with the same id", false)
  .option("--json", "emit machine-readable JSON", false)
  .action(async (options: { name: string; goal?: string; output?: string; force: boolean; json: boolean }) => {
    const result = await createTopic({
      name: options.name,
      ...(options.goal ? { goal: options.goal } : {}),
      ...(options.output ? { intendedOutput: options.output } : {}),
      force: options.force
    });

    if (options.json) {
      writeJsonOutput(result);
      return;
    }

    writeTextOutput(`Created topic ${result.topic.id} at ${result.topicDir}`);
  });

topicCommand
  .command("list")
  .description("List research topics in the current workspace")
  .option("--json", "emit machine-readable JSON", false)
  .action(async (options: { json: boolean }) => {
    const topics = await listTopics();

    if (options.json) {
      writeJsonOutput({ topics });
      return;
    }

    if (topics.length === 0) {
      writeTextOutput("No research topics found.");
      return;
    }

    for (const topic of topics) {
      writeTextOutput(`${topic.id}\t${topic.status}\t${topic.name}`);
    }
  });

topicCommand
  .command("show")
  .description("Show one research topic and its corpus metadata")
  .argument("<topic-id>", "topic id")
  .option("--json", "emit machine-readable JSON", false)
  .action(async (topicId: string, options: { json: boolean }) => {
    const { topic, corpus } = await loadTopic(topicId);
    writeJsonOutput({ topic, corpus });
  });
