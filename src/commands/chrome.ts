import { Command } from "commander";
import { closeManagedChrome, launchManagedChrome } from "../core/attach/launch-managed-chrome.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const chromeCommand = new Command("chrome").description(
  "Launch and inspect SourceLoop-managed Chrome browser workflows"
);

chromeCommand
  .command("launch")
  .description("Launch a dedicated isolated Chrome research profile and register it as an attach target")
  .option("--name <name>", "managed Chrome launch target name", "research-browser")
  .option("--chrome-path <path>", "explicit Google Chrome executable path")
  .option("--port <port>", "preferred remote debugging port")
  .option("--launch-arg <arg...>", "additional Chrome launch arguments")
  .option("--description <description>", "target description")
  .option("--force", "replace an existing attach target with the same id", false)
  .option("--json", "emit machine-readable JSON", false)
  .action(
    async (options: {
      name: string;
      chromePath?: string;
      port?: string;
      launchArg?: string[];
      description?: string;
      force: boolean;
      json: boolean;
    }) => {
      const result = await launchManagedChrome({
        name: options.name,
        ...(options.chromePath ? { chromeExecutablePath: options.chromePath } : {}),
        ...(options.port ? { remoteDebuggingPort: Number(options.port) } : {}),
        ...(options.launchArg ? { launchArgs: options.launchArg } : {}),
        ...(options.description ? { description: options.description } : {}),
        force: options.force
      });

      if (options.json) {
        writeJsonOutput(result);
        return;
      }

      writeTextOutput(
        `${result.launched ? "Launched" : "Reused"} managed Chrome ${result.target.id} at ${result.endpoint} using ${result.profileDirPath}`
      );
    }
  );

chromeCommand
  .command("close")
  .description("Close a SourceLoop-managed isolated Chrome browser")
  .argument("<target-id>", "managed Chrome attach target id")
  .option("--json", "emit machine-readable JSON", false)
  .action(async (targetId: string, options: { json: boolean }) => {
    const result = await closeManagedChrome({ targetId });

    if (options.json) {
      writeJsonOutput(result);
      return;
    }

    writeTextOutput(
      result.closed
        ? `Closed managed Chrome ${result.targetId}${result.processId ? ` (pid ${result.processId})` : ""}`
        : `Managed Chrome ${result.targetId} is not running.`
    );
  });
