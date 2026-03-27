import { Command } from "commander";
import { composeRun } from "../core/outputs/compose-run.js";

export const composeCommand = new Command("compose")
  .description("Compose a run archive into an Obsidian-friendly output artifact")
  .argument("<run-id>", "run id to compose")
  .requiredOption("--format <format>", "output format: brief or outline")
  .action(async (runId: string, options: { format: "brief" | "outline" }) => {
    const result = await composeRun({
      runId,
      format: options.format
    });

    process.stdout.write(`Composed ${result.artifact.format} at ${result.markdownPath}\n`);
  });

