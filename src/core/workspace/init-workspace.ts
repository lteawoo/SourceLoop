import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SOURCELOOP_CONFIG_DIR, SOURCELOOP_CONFIG_PATH, WORKSPACE_DIRECTORIES } from "./constants.js";
import { workspaceConfigSchema, type WorkspaceConfig } from "./schema.js";

type InitializeWorkspaceInput = {
  directory: string;
  force: boolean;
};

type InitializeWorkspaceResult = {
  rootDir: string;
  configPath: string;
  created: string[];
  message: string;
};

export async function initializeWorkspace(
  input: InitializeWorkspaceInput
): Promise<InitializeWorkspaceResult> {
  const rootDir = path.resolve(input.directory);

  await mkdir(rootDir, { recursive: true });

  const created: string[] = [];

  for (const relativeDirectory of WORKSPACE_DIRECTORIES) {
    const absoluteDirectory = path.join(rootDir, relativeDirectory);
    const existed = await pathExists(absoluteDirectory);
    await mkdir(absoluteDirectory, { recursive: true });

    if (!existed) {
      created.push(relativeDirectory);
    }
  }

  const configDirectory = path.join(rootDir, SOURCELOOP_CONFIG_DIR);
  const configPath = path.join(rootDir, SOURCELOOP_CONFIG_PATH);
  const configExists = await pathExists(configPath);

  if (configExists && !input.force) {
    throw new Error(
      `SourceLoop config already exists at ${configPath}. Re-run with --force to overwrite it.`
    );
  }

  await mkdir(configDirectory, { recursive: true });
  const config = workspaceConfigSchema.parse(buildWorkspaceConfig());
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  const configStatus = configExists ? "updated" : "created";
  const createdSummary =
    created.length === 0 ? "workspace directories already existed" : `created ${created.length} workspace directories`;

  return {
    rootDir,
    configPath,
    created,
    message: `Initialized SourceLoop workspace at ${rootDir} (${createdSummary}; config ${configStatus}).`
  };
}

function buildWorkspaceConfig(): WorkspaceConfig {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    paths: {
      chromeTargets: "vault/chrome-targets",
      topics: "vault/topics",
      sources: "vault/sources",
      notebookSources: "vault/notebook-sources",
      notebookSetups: "vault/notebook-setups",
      notebookImports: "vault/notebook-imports",
      notebooks: "vault/notebooks",
      bundles: "vault/bundles",
      runs: "vault/runs",
      outputs: "vault/outputs"
    }
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
