import { Command } from "commander";
import { clearNotebookAuth, getNotebookAuthStatus, setupNotebookAuth } from "../core/notebooklm/auth.js";

export const authCommand = new Command("auth").description(
  "Legacy NotebookLM auth helpers (deprecated: use attach-first workflow instead)"
);

authCommand
  .command("setup")
  .description("Legacy login bootstrap for NotebookLM (deprecated; use attach profile/endpoint instead)")
  .option("--profile <profile>", "browser profile alias", "default")
  .option("--timeout-minutes <minutes>", "login timeout in minutes", "10")
  .action(async (options: { profile: string; timeoutMinutes: string }) => {
    process.stderr.write(
      "Warning: auth setup is deprecated. Preferred workflow: sign in to Chrome yourself, register it with `sourceloop attach`, then run NotebookLM batches.\n"
    );
    const status = await setupNotebookAuth({
      profile: options.profile,
      timeoutMinutes: Number(options.timeoutMinutes)
    });

    process.stdout.write(
      `NotebookLM auth ready for profile ${status.profile} (${status.stateFilePath})\n`
    );
  });

authCommand
  .command("status")
  .description("Check legacy NotebookLM authentication status")
  .option("--profile <profile>", "browser profile alias", "default")
  .action(async (options: { profile: string }) => {
    const status = await getNotebookAuthStatus({ profile: options.profile });
    process.stdout.write(
      `${status.profile}: ${status.authenticated ? "authenticated" : "not authenticated"} (${status.stateFilePath})\n`
    );
  });

authCommand
  .command("clear")
  .description("Clear legacy NotebookLM authentication state for a profile")
  .option("--profile <profile>", "browser profile alias", "default")
  .action(async (options: { profile: string }) => {
    const status = await clearNotebookAuth({ profile: options.profile });
    process.stdout.write(`Cleared NotebookLM auth for profile ${status.profile}\n`);
  });
