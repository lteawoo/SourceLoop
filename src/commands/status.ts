import { Command } from "commander";
import { formatWorkspaceStatusReport, buildWorkspaceStatusReport } from "../core/operator/workspace-operator.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const statusCommand = new Command("status")
  .description("Show a workspace-level SourceLoop status overview")
  .option("--json", "emit machine-readable JSON", false)
  .action(async (options: { json: boolean }) => {
    const report = await buildWorkspaceStatusReport();

    if (options.json) {
      writeJsonOutput(report);
      return;
    }

    writeTextOutput(formatWorkspaceStatusReport(report));
  });
