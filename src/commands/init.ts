import { Command, Option } from "commander";
import { initializeWorkspace } from "../core/workspace/init-workspace.js";
import { SUPPORTED_AGENT_BOOTSTRAPS, type SupportedAgentBootstrap } from "../core/workspace/bootstrap.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const initCommand = new Command("init")
  .description("Initialize a SourceLoop workspace in the target directory")
  .argument("[directory]", "target directory to initialize", ".")
  .addOption(
    new Option("--ai <target>", "generate a project-local AI operator bootstrap")
      .choices(SUPPORTED_AGENT_BOOTSTRAPS as unknown as string[])
  )
  .option("--force", "overwrite an existing SourceLoop config file", false)
  .option("--json", "emit machine-readable JSON", false)
  .action(async (directory: string, options: { force: boolean; ai?: SupportedAgentBootstrap; json: boolean }) => {
    const result = await initializeWorkspace({
      directory,
      force: options.force,
      ...(options.ai ? { ai: options.ai } : {})
    });

    if (options.json) {
      writeJsonOutput(result);
      return;
    }

    writeTextOutput(result.message);
  });
