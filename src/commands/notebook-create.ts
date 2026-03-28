import { Command } from "commander";
import { createManagedNotebook } from "../core/notebooks/manage-managed-notebooks.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const notebookCreateCommand = new Command("notebook-create")
  .description("Create a fresh NotebookLM notebook through an attached Chrome session")
  .requiredOption("--name <name>", "notebook display name")
  .requiredOption("--topic-id <topic-id>", "topic id")
  .requiredOption("--attach-target <target-id>", "attached Chrome target id")
  .option("--access <mode>", "notebook access mode", "owner")
  .option("--description <description>", "description of the notebook contents")
  .option("--topics <topics>", "comma-separated notebook tags")
  .option("--force", "overwrite an existing managed setup with the same id", false)
  .option("--show-browser", "show the attached browser while creating the notebook", false)
  .option("--json", "emit machine-readable JSON", false)
  .action(
    async (options: {
      name: string;
      topicId: string;
      attachTarget: string;
      access: "owner" | "shared" | "chat-only";
      description?: string;
      topics?: string;
      force: boolean;
      showBrowser: boolean;
      json: boolean;
    }) => {
      const result = await createManagedNotebook({
        name: options.name,
        topicId: options.topicId,
        attachTargetId: options.attachTarget,
        accessMode: options.access,
        ...(options.description ? { description: options.description } : {}),
        ...(options.topics
          ? {
              topics: options.topics
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            }
          : {}),
        force: options.force,
        showBrowser: options.showBrowser
      });

      if (options.json) {
        writeJsonOutput(result);
        return;
      }

      writeTextOutput(`Created managed notebook ${result.binding.id} at ${result.bindingMarkdownPath}`);
    }
  );
