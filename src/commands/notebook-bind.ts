import { Command } from "commander";
import { bindNotebook } from "../core/notebooks/bind-notebook.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const notebookBindCommand = new Command("notebook-bind")
  .description("Create a notebook binding record for a NotebookLM target")
  .requiredOption("--name <name>", "binding display name")
  .option("--topic <topic>", "legacy freeform research topic for the notebook")
  .option("--topic-id <topic-id>", "topic id for the preferred topic-first workflow")
  .requiredOption("--url <url>", "NotebookLM notebook URL")
  .option("--access <mode>", "notebook access mode", "owner")
  .option("--force", "overwrite an existing binding with the same id", false)
  .option("--description <description>", "description of the notebook contents")
  .option("--topics <topics>", "comma-separated notebook topics")
  .option("--attach-target <target-id>", "default attached Chrome target for this notebook")
  .option("--browser-profile <profile>", "browser profile alias for this binding")
  .option("--json", "emit machine-readable JSON", false)
  .action(
    async (options: {
      name: string;
      topic: string;
      topicId?: string;
      url: string;
      access: "owner" | "shared" | "chat-only";
      force: boolean;
      description?: string;
      topics?: string;
      attachTarget?: string;
      browserProfile?: string;
      json: boolean;
    }) => {
      if (!options.topicId && !options.topic) {
        throw new Error("Provide --topic-id for the preferred topic-first flow or --topic for the legacy notebook-first flow.");
      }

      const result = await bindNotebook({
        name: options.name,
        topic: options.topic ?? options.topicId ?? options.name,
        notebookUrl: options.url,
        accessMode: options.access,
        force: options.force,
        topics: options.topics?.split(",").map((topic) => topic.trim()).filter(Boolean) ?? [],
        ...(options.description ? { description: options.description } : {}),
        ...(options.topicId ? { topicId: options.topicId } : {}),
        ...(options.attachTarget ? { attachTargetId: options.attachTarget } : {}),
        ...(options.browserProfile ? { browserProfile: options.browserProfile } : {})
      });

      if (options.json) {
        writeJsonOutput(result);
        return;
      }

      writeTextOutput(`Bound notebook ${result.binding.id} at ${result.markdownPath}`);
    }
  );
