import { Command } from "commander";
import { createTopic, listTopics, loadTopic } from "../core/topics/manage-topics.js";

export const topicCommand = new Command("topic").description("Create and inspect topic-first research roots");

topicCommand
  .command("create")
  .description("Create a research topic root")
  .requiredOption("--name <name>", "topic display name")
  .option("--goal <goal>", "optional research goal for this topic")
  .option("--output <output>", "optional output hint, for example lecture, brief, or playbook")
  .option("--force", "overwrite an existing topic with the same id", false)
  .action(async (options: { name: string; goal?: string; output?: string; force: boolean }) => {
    const result = await createTopic({
      name: options.name,
      ...(options.goal ? { goal: options.goal } : {}),
      ...(options.output ? { intendedOutput: options.output } : {}),
      force: options.force
    });

    process.stdout.write(`Created topic ${result.topic.id} at ${result.topicDir}\n`);
  });

topicCommand
  .command("list")
  .description("List research topics in the current workspace")
  .action(async () => {
    const topics = await listTopics();

    if (topics.length === 0) {
      process.stdout.write("No research topics found.\n");
      return;
    }

    for (const topic of topics) {
      process.stdout.write(`${topic.id}\t${topic.status}\t${topic.name}\n`);
    }
  });

topicCommand
  .command("show")
  .description("Show one research topic and its corpus metadata")
  .argument("<topic-id>", "topic id")
  .action(async (topicId: string) => {
    const { topic, corpus } = await loadTopic(topicId);
    process.stdout.write(`${JSON.stringify({ topic, corpus }, null, 2)}\n`);
  });
