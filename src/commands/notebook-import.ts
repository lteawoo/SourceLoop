import { Command } from "commander";
import { importIntoManagedNotebook } from "../core/notebooks/manage-managed-notebooks.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const notebookImportCommand = new Command("notebook-import")
  .description("Import a local SourceLoop source or remote URL into a managed NotebookLM notebook")
  .requiredOption("--notebook <binding-id>", "managed notebook binding id")
  .option("--source-id <source-id>", "existing SourceLoop source artifact id")
  .option("--url <url>", "remote URL to import")
  .option("--title <title>", "override import title")
  .option("--force", "overwrite an existing managed import with the same id", false)
  .option("--show-browser", "show the attached browser while importing", false)
  .option("--json", "emit machine-readable JSON", false)
  .action(
    async (options: {
      notebook: string;
      sourceId?: string;
      url?: string;
      title?: string;
      force: boolean;
      showBrowser: boolean;
      json: boolean;
    }) => {
      const sourceModes = [options.sourceId ? "sourceId" : undefined, options.url ? "url" : undefined].filter(Boolean);
      if (sourceModes.length !== 1) {
        throw new Error("Provide exactly one of --source-id or --url.");
      }

      const result = await importIntoManagedNotebook(
        options.sourceId
          ? {
              notebookBindingId: options.notebook,
              sourceId: options.sourceId,
              ...(options.title ? { title: options.title } : {}),
              force: options.force,
              showBrowser: options.showBrowser
            }
          : {
              notebookBindingId: options.notebook,
              url: options.url!,
              ...(options.title ? { title: options.title } : {}),
              force: options.force,
              showBrowser: options.showBrowser
            }
      );

      if (options.json) {
        writeJsonOutput(result);
        return;
      }

      writeTextOutput(`Imported ${result.managedImport.sourceUri} into ${result.managedImport.notebookBindingId} (${result.managedImport.status})`);
    }
  );
