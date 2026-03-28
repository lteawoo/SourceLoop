import { readFile } from "node:fs/promises";
import path from "node:path";
import { SOURCELOOP_CONFIG_PATH } from "./constants.js";
import { workspaceConfigSchema, type WorkspaceConfig } from "./schema.js";

export type LoadedWorkspace = {
  rootDir: string;
  config: WorkspaceConfig;
};

export async function loadWorkspace(startDir = process.cwd()): Promise<LoadedWorkspace> {
  const rootDir = await findWorkspaceRoot(startDir);
  const configPath = path.join(rootDir, SOURCELOOP_CONFIG_PATH);
  const configRaw = await readFile(configPath, "utf8");
  const config = workspaceConfigSchema.parse(withWorkspaceDefaults(JSON.parse(configRaw) as Partial<WorkspaceConfig>));

  return {
    rootDir,
    config
  };
}

function withWorkspaceDefaults(config: Partial<WorkspaceConfig>): WorkspaceConfig {
  return {
    version: 1,
    createdAt: config.createdAt ?? new Date(0).toISOString(),
    paths: {
      chromeTargets: config.paths?.chromeTargets ?? "vault/chrome-targets",
      topics: config.paths?.topics ?? "vault/topics",
      sources: config.paths?.sources ?? "vault/sources",
      notebookSources: config.paths?.notebookSources ?? "vault/notebook-sources",
      notebooks: config.paths?.notebooks ?? "vault/notebooks",
      bundles: config.paths?.bundles ?? "vault/bundles",
      runs: config.paths?.runs ?? "vault/runs",
      outputs: config.paths?.outputs ?? "vault/outputs"
    }
  };
}

async function findWorkspaceRoot(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, SOURCELOOP_CONFIG_PATH);

    try {
      await readFile(candidate, "utf8");
      return currentDir;
    } catch {
      const parentDir = path.dirname(currentDir);

      if (parentDir === currentDir) {
        throw new Error(
          `No SourceLoop workspace found from ${startDir}. Run "sourceloop init" first.`
        );
      }

      currentDir = parentDir;
    }
  }
}
