import { Command } from "commander";
import {
  listChromeAttachTargets,
  loadChromeAttachTarget,
  registerChromeEndpointTarget,
  registerChromeProfileTarget,
  removeChromeAttachTarget,
  upsertChromeAttachTarget
} from "../core/attach/manage-targets.js";
import { validateChromeAttachTarget } from "../core/notebooklm/browser-agent.js";
import { chromeProfileIsolationSchema } from "../schemas/attach.js";

export const attachCommand = new Command("attach").description(
  "Register and inspect attached Chrome targets for NotebookLM execution"
);

attachCommand
  .command("profile")
  .description("Register a Chrome profile directory to launch and attach for NotebookLM runs")
  .requiredOption("--name <name>", "attach target name")
  .requiredOption("--profile-dir <path>", "Chrome user data directory that is already signed in")
  .option(
    "--profile-isolation <isolation>",
    "Chrome profile isolation posture: isolated, unknown, or shared",
    "unknown"
  )
  .option("--chrome-path <path>", "explicit Google Chrome executable path")
  .option("--port <port>", "preferred remote debugging port for launched Chrome")
  .option("--launch-arg <arg...>", "additional Chrome launch arguments")
  .option("--description <description>", "target description")
  .option("--force", "overwrite an existing attach target with the same id", false)
  .action(
    async (options: {
      name: string;
      profileDir: string;
      profileIsolation: string;
      chromePath?: string;
      port?: string;
      launchArg?: string[];
      description?: string;
      force: boolean;
    }) => {
      const result = await registerChromeProfileTarget({
        name: options.name,
        profileDirPath: options.profileDir,
        profileIsolation: chromeProfileIsolationSchema.parse(options.profileIsolation),
        launchArgs: options.launchArg ?? [],
        force: options.force,
        ...(options.chromePath ? { chromeExecutablePath: options.chromePath } : {}),
        ...(options.port ? { remoteDebuggingPort: Number(options.port) } : {}),
        ...(options.description ? { description: options.description } : {})
      });

      process.stdout.write(`Registered attach target ${result.target.id} at ${result.markdownPath}\n`);
    }
  );

attachCommand
  .command("endpoint")
  .description("Register an existing Chrome remote debugging endpoint for NotebookLM runs")
  .requiredOption("--name <name>", "attach target name")
  .requiredOption("--endpoint <url>", "Chrome remote debugging endpoint, for example http://127.0.0.1:9222")
  .option(
    "--profile-isolation <isolation>",
    "Chrome profile isolation posture behind the endpoint: isolated, unknown, or shared",
    "unknown"
  )
  .option("--description <description>", "target description")
  .option("--force", "overwrite an existing attach target with the same id", false)
  .action(async (options: { name: string; endpoint: string; profileIsolation: string; description?: string; force: boolean }) => {
    const result = await registerChromeEndpointTarget({
      name: options.name,
      endpoint: options.endpoint,
      profileIsolation: chromeProfileIsolationSchema.parse(options.profileIsolation),
      force: options.force,
      ...(options.description ? { description: options.description } : {})
    });

    process.stdout.write(`Registered attach target ${result.target.id} at ${result.markdownPath}\n`);
  });

attachCommand
  .command("list")
  .description("List registered Chrome attach targets")
  .action(async () => {
    const targets = await listChromeAttachTargets();
    if (targets.length === 0) {
      process.stdout.write("No Chrome attach targets registered.\n");
      return;
    }

    for (const target of targets) {
      const summary =
        target.targetType === "profile" ? target.profileDirPath : target.endpoint;
      process.stdout.write(`${target.id}\t${target.targetType}\t${target.profileIsolation}\t${summary}\n`);
    }
  });

attachCommand
  .command("show")
  .description("Show one registered Chrome attach target")
  .argument("<target-id>", "attach target id")
  .action(async (targetId: string) => {
    const { target } = await loadChromeAttachTarget(targetId);
    process.stdout.write(`${JSON.stringify(target, null, 2)}\n`);
  });

attachCommand
  .command("validate")
  .description("Validate that a Chrome attach target can reach NotebookLM")
  .argument("<target-id>", "attach target id")
  .option("--notebook-url <url>", "NotebookLM notebook URL to preflight")
  .option("--show-browser", "show Chrome while validating a profile attach target", false)
  .action(async (targetId: string, options: { notebookUrl?: string; showBrowser: boolean }) => {
    const { target } = await loadChromeAttachTarget(targetId);
    const result = await validateChromeAttachTarget({
      target,
      ...(options.notebookUrl ? { notebookUrl: options.notebookUrl } : {}),
      showBrowser: options.showBrowser
    });

    if (result.ok) {
      const validatedTarget = {
        ...target,
        notebooklmReadiness: "validated" as const,
        notebooklmValidatedAt: new Date().toISOString()
      };
      await upsertChromeAttachTarget(validatedTarget);
      process.stdout.write(`Attach target ${targetId} is ready for NotebookLM execution.\n`);
      return;
    }

    throw new Error(`[${result.code}] ${result.message}`);
  });

attachCommand
  .command("remove")
  .description("Remove a registered Chrome attach target")
  .argument("<target-id>", "attach target id")
  .action(async (targetId: string) => {
    await removeChromeAttachTarget({ targetId });
    process.stdout.write(`Removed attach target ${targetId}\n`);
  });
