import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { notebookBindingSchema, type NotebookBinding } from "../../schemas/notebook.js";
import { questionBatchSchema, qaExchangeSchema, runIndexSchema, type QAExchange, type QARunIndex, type QuestionBatch } from "../../schemas/run.js";
import { getRunPaths, getVaultPaths } from "../vault/paths.js";

export async function loadNotebookBinding(
  bindingId: string,
  cwd?: string
): Promise<{ workspace: Awaited<ReturnType<typeof loadWorkspace>>; binding: NotebookBinding; path: string }> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const bindingPath = path.join(vault.notebooksDir, `${bindingId}.json`);
  const bindingRaw = await readFile(bindingPath, "utf8");
  const binding = notebookBindingSchema.parse(JSON.parse(bindingRaw));

  return { workspace, binding, path: bindingPath };
}

export async function loadQuestionBatch(
  runId: string,
  cwd?: string
): Promise<{ workspace: Awaited<ReturnType<typeof loadWorkspace>>; batch: QuestionBatch; run: QARunIndex }> {
  const workspace = await loadWorkspace(cwd);
  const runPaths = getRunPaths(workspace, runId);
  const [batchRaw, runRaw] = await Promise.all([
    readFile(runPaths.questionsJsonPath, "utf8"),
    readFile(runPaths.indexJsonPath, "utf8")
  ]);

  return {
    workspace,
    batch: questionBatchSchema.parse(JSON.parse(batchRaw)),
    run: runIndexSchema.parse(JSON.parse(runRaw))
  };
}

export async function loadRunExchanges(runId: string, cwd?: string): Promise<QAExchange[]> {
  const workspace = await loadWorkspace(cwd);
  const runPaths = getRunPaths(workspace, runId);
  try {
    const files = await readDirJsonFiles(runPaths.exchangesDir);
    const records = await Promise.all(files.map((filePath) => readFile(filePath, "utf8")));
    return records.map((record) => qaExchangeSchema.parse(JSON.parse(record)));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

async function readDirJsonFiles(directory: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory);
  return entries.filter((entry) => entry.endsWith(".json")).map((entry) => path.join(directory, entry));
}

function isMissingDirectoryError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
