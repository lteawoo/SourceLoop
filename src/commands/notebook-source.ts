import { Command } from "commander";
import {
  declareNotebookSourceManifest,
  listNotebookSourceManifests,
  loadNotebookSourceManifest
} from "../core/notebooks/manage-notebook-source-manifests.js";

export const notebookSourceCommand = new Command("notebook-source").description(
  "Declare and inspect NotebookLM-backed source manifests"
);

notebookSourceCommand
  .command("declare")
  .description("Declare an existing NotebookLM source bundle for a topic-bound notebook")
  .requiredOption("--topic-id <topic-id>", "topic id")
  .requiredOption("--notebook <binding-id>", "notebook binding id")
  .requiredOption("--kind <kind>", "source bundle kind")
  .requiredOption("--title <title>", "manifest display title")
  .option("--description <description>", "manifest description")
  .option("--item-count <count>", "optional bundle item count", parsePositiveInteger)
  .option("--ref <ref>", "reference URL or note", collectValue, [])
  .option("--force", "overwrite an existing manifest with the same id", false)
  .action(
    async (options: {
      topicId: string;
      notebook: string;
      kind: string;
      title: string;
      description?: string;
      itemCount?: number;
      ref: string[];
      force: boolean;
    }) => {
      const result = await declareNotebookSourceManifest({
        topicId: options.topicId,
        notebookBindingId: options.notebook,
        kind: options.kind,
        title: options.title,
        ...(options.description ? { description: options.description } : {}),
        ...(options.itemCount !== undefined ? { itemCount: options.itemCount } : {}),
        ...(options.ref.length ? { refs: options.ref } : {}),
        force: options.force
      });

      process.stdout.write(`Declared notebook source manifest ${result.manifest.id} at ${result.markdownPath}\n`);
    }
  );

notebookSourceCommand
  .command("list")
  .description("List notebook-backed source manifests in the current workspace")
  .action(async () => {
    const manifests = await listNotebookSourceManifests();
    if (manifests.length === 0) {
      process.stdout.write("No notebook source manifests found.\n");
      return;
    }
    for (const manifest of manifests) {
      process.stdout.write(`${manifest.id}\t${manifest.topicId}\t${manifest.notebookBindingId}\t${manifest.title}\n`);
    }
  });

notebookSourceCommand
  .command("show")
  .description("Show one notebook-backed source manifest")
  .argument("<manifest-id>", "manifest id")
  .action(async (manifestId: string) => {
    const { manifest } = await loadNotebookSourceManifest(manifestId);
    process.stdout.write(`${JSON.stringify({ manifest }, null, 2)}\n`);
  });

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }
  return parsed;
}

function collectValue(value: string, previous: string[]): string[] {
  return [...previous, value.trim()].filter(Boolean);
}
