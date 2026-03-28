import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SOURCELOOP_CONFIG_DIR, SOURCELOOP_CONFIG_PATH, WORKSPACE_DIRECTORIES } from "./constants.js";
import { workspaceConfigSchema, type WorkspaceConfig } from "./schema.js";
import {
  bootstrapWorkspaceAgent,
  type SupportedAgentBootstrap,
  type WorkspaceBootstrapResult,
  validateWorkspaceAgentBootstrap
} from "./bootstrap.js";

type InitializeWorkspaceInput = {
  directory: string;
  force: boolean;
  ai?: SupportedAgentBootstrap;
};

type InitializeWorkspaceResult = {
  rootDir: string;
  configPath: string;
  created: string[];
  bootstrap?: WorkspaceBootstrapResult;
  message: string;
};

export async function initializeWorkspace(
  input: InitializeWorkspaceInput
): Promise<InitializeWorkspaceResult> {
  const rootDir = path.resolve(input.directory);
  const configPath = path.join(rootDir, SOURCELOOP_CONFIG_PATH);

  await mkdir(rootDir, { recursive: true });
  const configExists = await pathExists(configPath);
  const bootstrapOnlyAddition = Boolean(input.ai && configExists && !input.force);

  if (input.ai) {
    await validateWorkspaceAgentBootstrap({
      rootDir,
      ai: input.ai,
      force: input.force
    });
  }

  if (configExists && !input.force && !bootstrapOnlyAddition) {
    throw new Error(
      `SourceLoop config already exists at ${configPath}. Re-run with --force to overwrite it.`
    );
  }

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
  const shouldWriteConfig = !configExists || input.force;

  if (shouldWriteConfig) {
    await mkdir(configDirectory, { recursive: true });
    const config = workspaceConfigSchema.parse(buildWorkspaceConfig());
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  }

  const bootstrap = input.ai
    ? await bootstrapWorkspaceAgent({
        rootDir,
        ai: input.ai,
        force: input.force
      })
    : undefined;

  const configStatus = shouldWriteConfig ? (configExists ? "updated" : "created") : "unchanged";
  const createdSummary =
    created.length === 0 ? "workspace directories already existed" : `created ${created.length} workspace directories`;
  const bootstrapSummary = bootstrap
    ? `; ${bootstrap.ai} bootstrap created ${bootstrap.created.length} file(s)`
    : "";

  return {
    rootDir,
    configPath,
    created,
    ...(bootstrap ? { bootstrap } : {}),
    message: `Initialized SourceLoop workspace at ${rootDir} (${createdSummary}; config ${configStatus}${bootstrapSummary}).`
  };
}

function buildWorkspaceConfig(): WorkspaceConfig {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    paths: {
      chromeProfiles: ".sourceloop/chrome-profiles",
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
