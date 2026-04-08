import path from "node:path";
import type { LoadedWorkspace } from "../workspace/load-workspace.js";

export function getVaultPaths(workspace: LoadedWorkspace) {
  const root = workspace.rootDir;
  const vaultRoot = path.join(root, "vault");

  return {
    root,
    vaultRoot,
    chromeProfilesDir: path.join(root, workspace.config.paths.chromeProfiles),
    chromeTargetsDir: path.join(vaultRoot, "chrome-targets"),
    topicsDir: path.join(vaultRoot, "topics"),
    sourcesDir: path.join(vaultRoot, "sources"),
    notebookSourcesDir: path.join(vaultRoot, "notebook-sources"),
    notebookSetupsDir: path.join(vaultRoot, "notebook-setups"),
    notebookImportsDir: path.join(vaultRoot, "notebook-imports"),
    notebooksDir: path.join(vaultRoot, "notebooks"),
    runsDir: path.join(vaultRoot, "runs"),
    outputsDir: path.join(vaultRoot, "outputs")
  };
}

export function getTopicPaths(workspace: LoadedWorkspace, topicId: string) {
  const vault = getVaultPaths(workspace);
  const topicDir = path.join(vault.topicsDir, topicId);

  return {
    topicDir,
    indexMarkdownPath: path.join(topicDir, "index.md"),
    indexJsonPath: path.join(topicDir, "index.json"),
    corpusMarkdownPath: path.join(topicDir, "corpus.md"),
    corpusJsonPath: path.join(topicDir, "corpus.json")
  };
}

export function getRunPaths(workspace: LoadedWorkspace, runId: string) {
  const vault = getVaultPaths(workspace);
  const runDir = path.join(vault.runsDir, runId);

  return {
    runDir,
    indexMarkdownPath: path.join(runDir, "index.md"),
    indexJsonPath: path.join(runDir, "index.json"),
    planningContextJsonPath: path.join(runDir, "planning-context.json"),
    questionsMarkdownPath: path.join(runDir, "questions.md"),
    questionsJsonPath: path.join(runDir, "questions.json"),
    exchangesDir: path.join(runDir, "exchanges"),
    outputsDir: path.join(runDir, "outputs")
  };
}
