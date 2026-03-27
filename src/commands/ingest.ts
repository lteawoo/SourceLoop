import { Command } from "commander";
import { ingestSource } from "../core/ingest/ingest-source.js";

export const ingestCommand = new Command("ingest")
  .description("Ingest a local file or URL into the current SourceLoop workspace")
  .argument("<input>", "file path or URL to ingest")
  .option("--topic <topic-id>", "topic to attach this source to")
  .action(async (input: string, options: { topic?: string }) => {
    const result = await ingestSource({
      input,
      ...(options.topic ? { topicId: options.topic } : {})
    });

    process.stdout.write(`Ingested ${result.source.type} source into ${result.outputPath}\n`);
  });
