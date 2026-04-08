#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import { attachCommand } from "./commands/attach.js";
import { authCommand } from "./commands/auth.js";
import { chromeCommand } from "./commands/chrome.js";
import { composeCommand } from "./commands/compose.js";
import { doctorCommand } from "./commands/doctor.js";
import { ingestCommand } from "./commands/ingest.js";
import { importLatestCommand } from "./commands/import-latest.js";
import { initCommand } from "./commands/init.js";
import { notebookBindCommand } from "./commands/notebook-bind.js";
import { notebookCreateCommand } from "./commands/notebook-create.js";
import { notebookImportCommand } from "./commands/notebook-import.js";
import { notebookSourceCommand } from "./commands/notebook-source.js";
import { planContextCommand } from "./commands/plan-context.js";
import { planCommand } from "./commands/plan.js";
import { runCommand } from "./commands/run.js";
import { statusCommand } from "./commands/status.js";
import { topicCommand } from "./commands/topic.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
const program = new Command();

program
  .name("sourceloop")
  .description("NotebookLM-centered research orchestration pipeline")
  .version(version);

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(doctorCommand);
program.addCommand(ingestCommand);
program.addCommand(importLatestCommand);
program.addCommand(topicCommand);
program.addCommand(chromeCommand);
program.addCommand(attachCommand);
program.addCommand(authCommand);
program.addCommand(notebookBindCommand);
program.addCommand(notebookCreateCommand);
program.addCommand(notebookImportCommand);
program.addCommand(notebookSourceCommand);
program.addCommand(planContextCommand);
program.addCommand(planCommand);
program.addCommand(runCommand);
program.addCommand(composeCommand);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const exitCode =
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    typeof error.exitCode === "number"
      ? error.exitCode
      : 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith("error:") ? message : `error: ${message}`);
  process.exit(exitCode);
}
