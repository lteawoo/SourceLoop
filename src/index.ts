#!/usr/bin/env node

import { Command } from "commander";
import { attachCommand } from "./commands/attach.js";
import { authCommand } from "./commands/auth.js";
import { composeCommand } from "./commands/compose.js";
import { ingestCommand } from "./commands/ingest.js";
import { importLatestCommand } from "./commands/import-latest.js";
import { initCommand } from "./commands/init.js";
import { notebookBindCommand } from "./commands/notebook-bind.js";
import { planCommand } from "./commands/plan.js";
import { runCommand } from "./commands/run.js";
import { topicCommand } from "./commands/topic.js";

const program = new Command();

program
  .name("sourceloop")
  .description("NotebookLM-centered research orchestration pipeline")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(ingestCommand);
program.addCommand(importLatestCommand);
program.addCommand(topicCommand);
program.addCommand(attachCommand);
program.addCommand(authCommand);
program.addCommand(notebookBindCommand);
program.addCommand(planCommand);
program.addCommand(runCommand);
program.addCommand(composeCommand);

await program.parseAsync(process.argv);
