import { Command } from "commander";
import { initializeWorkspace } from "../core/workspace/init-workspace.js";

export const initCommand = new Command("init")
  .description("Initialize a SourceLoop workspace in the target directory")
  .argument("[directory]", "target directory to initialize", ".")
  .option("--force", "overwrite an existing SourceLoop config file", false)
  .action(async (directory: string, options: { force: boolean }) => {
    const result = await initializeWorkspace({
      directory,
      force: options.force
    });

    process.stdout.write(`${result.message}\n`);
  });

