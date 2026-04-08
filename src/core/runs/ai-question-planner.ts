import { spawn } from "node:child_process";
import {
  plannedQuestionDraftBundleSchema,
  plannedQuestionDraftListSchema,
  questionPlanningContextSchema,
  type PlannedQuestionDraft,
  type QuestionPlanningContext
} from "../../schemas/run.js";

export const QUESTION_PLANNER_COMMAND_ENV = "SOURCELOOP_QUESTION_PLANNER_CMD";

export type QuestionPlannerInput = {
  context: QuestionPlanningContext;
  maxQuestions?: number;
};

export type QuestionPlanner = (input: QuestionPlannerInput) => Promise<PlannedQuestionDraft[]>;

export async function generateQuestionsFromPlanningContext(
  input: QuestionPlannerInput,
  overrides?: {
    planner?: QuestionPlanner;
    env?: NodeJS.ProcessEnv;
    shell?: string;
  }
): Promise<PlannedQuestionDraft[]> {
  questionPlanningContextSchema.parse(input.context);

  if (overrides?.planner) {
    return plannedQuestionDraftListSchema.parse(await overrides.planner(input));
  }

  const env = overrides?.env ?? process.env;
  const command = env[QUESTION_PLANNER_COMMAND_ENV]?.trim();
  if (!command) {
    throw new Error(
      `AI question planner is not configured. Use sourceloop plan-context --json, have the active agent author question JSON, then pass it back with sourceloop plan ... --questions-file -. Set ${QUESTION_PLANNER_COMMAND_ENV} only if you still want an external planner command fallback.`
    );
  }

  return runExternalPlannerCommand(command, input, {
    env,
    ...(overrides?.shell ? { shell: overrides.shell } : {})
  });
}

async function runExternalPlannerCommand(
  command: string,
  input: QuestionPlannerInput,
  options?: {
    env?: NodeJS.ProcessEnv;
    shell?: string;
  }
): Promise<PlannedQuestionDraft[]> {
  const shell = options?.shell ?? process.env.SHELL ?? "/bin/zsh";
  const payload = JSON.stringify(input, null, 2);

  const child = spawn(shell, ["-lc", command], {
    env: options?.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
    child.stdin.end(payload);
  });

  if (exitCode !== 0) {
    const message = stderr.trim() || stdout.trim() || `planner command exited with code ${exitCode}`;
    throw new Error(`AI question planner failed: ${message}`);
  }

  const raw = stdout.trim();
  if (!raw) {
    throw new Error("AI question planner returned no output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `AI question planner returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (Array.isArray(parsed)) {
    return plannedQuestionDraftListSchema.parse(parsed);
  }

  return plannedQuestionDraftBundleSchema.parse(parsed).questions;
}
