import { Command } from "commander";
import { buildDoctorReport, formatDoctorReport } from "../core/operator/workspace-operator.js";
import { writeJsonOutput, writeTextOutput } from "../lib/cli-output.js";

export const doctorCommand = new Command("doctor")
  .description("Diagnose missing or broken SourceLoop workflow prerequisites")
  .option("--json", "emit machine-readable JSON", false)
  .action(async (options: { json: boolean }) => {
    const report = await buildDoctorReport();

    if (options.json) {
      writeJsonOutput(report);
      return;
    }

    writeTextOutput(formatDoctorReport(report));
  });
