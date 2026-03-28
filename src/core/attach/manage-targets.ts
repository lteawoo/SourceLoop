import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkspace } from "../workspace/load-workspace.js";
import {
  chromeAttachTargetSchema,
  type ChromeAttachTarget,
  type ChromeAttachOwnership,
  type ChromeNotebooklmReadiness,
  type ChromeProfileIsolation,
  type ChromeEndpointAttachTarget,
  type ChromeProfileAttachTarget
} from "../../schemas/attach.js";
import { slugify } from "../../lib/slugify.js";
import { getVaultPaths } from "../vault/paths.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { getChromeTargetNote } from "../vault/notes.js";

type RegisterChromeProfileTargetInput = {
  name: string;
  profileDirPath: string;
  profileIsolation?: ChromeProfileIsolation;
  ownership?: Exclude<ChromeAttachOwnership, "external">;
  notebooklmReadiness?: ChromeNotebooklmReadiness;
  notebooklmValidatedAt?: string;
  chromeExecutablePath?: string;
  currentProcessId?: number;
  remoteDebuggingPort?: number;
  launchArgs?: string[];
  description?: string;
  createdAt?: string;
  force?: boolean;
  cwd?: string;
};

type RegisterChromeEndpointTargetInput = {
  name: string;
  endpoint: string;
  profileIsolation?: ChromeProfileIsolation;
  notebooklmReadiness?: ChromeNotebooklmReadiness;
  notebooklmValidatedAt?: string;
  description?: string;
  force?: boolean;
  cwd?: string;
};

export type RegisterChromeAttachTargetResult = {
  target: ChromeAttachTarget;
  markdownPath: string;
  jsonPath: string;
};

export async function registerChromeProfileTarget(
  input: RegisterChromeProfileTargetInput
): Promise<RegisterChromeAttachTargetResult> {
  return persistChromeAttachTarget(
    input.cwd,
    chromeAttachTargetSchema.parse({
      id: `attach-${slugify(input.name)}`,
      type: "chrome_attach_target",
      name: input.name,
      description: input.description,
      profileIsolation: input.profileIsolation ?? "unknown",
      ownership: input.ownership ?? "user_managed",
      notebooklmReadiness: input.notebooklmReadiness ?? "unknown",
      notebooklmValidatedAt: input.notebooklmValidatedAt,
      targetType: "profile",
      profileDirPath: path.resolve(input.profileDirPath),
      chromeExecutablePath: input.chromeExecutablePath ? path.resolve(input.chromeExecutablePath) : undefined,
      currentProcessId: input.currentProcessId,
      remoteDebuggingPort: input.remoteDebuggingPort,
      launchArgs: input.launchArgs ?? [],
      createdAt: input.createdAt ?? new Date().toISOString()
    }),
    input.force ?? false
  );
}

export async function registerChromeEndpointTarget(
  input: RegisterChromeEndpointTargetInput
): Promise<RegisterChromeAttachTargetResult> {
  return persistChromeAttachTarget(
    input.cwd,
    chromeAttachTargetSchema.parse({
      id: `attach-${slugify(input.name)}`,
      type: "chrome_attach_target",
      name: input.name,
      description: input.description,
      profileIsolation: input.profileIsolation ?? "unknown",
      ownership: "external",
      notebooklmReadiness: input.notebooklmReadiness ?? "unknown",
      notebooklmValidatedAt: input.notebooklmValidatedAt,
      targetType: "remote_debugging_endpoint",
      endpoint: input.endpoint,
      createdAt: new Date().toISOString()
    }),
    input.force ?? false
  );
}

export async function loadChromeAttachTarget(
  targetId: string,
  cwd?: string
): Promise<{ workspace: Awaited<ReturnType<typeof loadWorkspace>>; target: ChromeAttachTarget; path: string }> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const targetPath = path.join(vault.chromeTargetsDir, `${targetId}.json`);
  const raw = await readFile(targetPath, "utf8");
  const target = chromeAttachTargetSchema.parse(JSON.parse(raw));
  return { workspace, target, path: targetPath };
}

export async function upsertChromeAttachTarget(
  target: ChromeAttachTarget,
  input?: { cwd?: string; force?: boolean }
): Promise<RegisterChromeAttachTargetResult> {
  return persistChromeAttachTarget(input?.cwd, target, input?.force ?? true);
}

export async function listChromeAttachTargets(cwd?: string): Promise<ChromeAttachTarget[]> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);

  try {
    const entries = await readdir(vault.chromeTargetsDir);
    const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
    const raw = await Promise.all(jsonFiles.map((entry) => readFile(path.join(vault.chromeTargetsDir, entry), "utf8")));
    return raw.map((value) => chromeAttachTargetSchema.parse(JSON.parse(value))).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

export async function removeChromeAttachTarget(input: { targetId: string; cwd?: string }): Promise<void> {
  const workspace = await loadWorkspace(input.cwd);
  const vault = getVaultPaths(workspace);
  const basePath = path.join(vault.chromeTargetsDir, input.targetId);
  let notePath = `${basePath}.md`;
  try {
    const raw = await readFile(`${basePath}.json`, "utf8");
    const target = chromeAttachTargetSchema.parse(JSON.parse(raw));
    notePath = getChromeTargetNote(workspace, target).absolutePath;
  } catch {
    // fall back to the legacy id-first markdown path
  }

  await Promise.all([rm(`${basePath}.json`, { force: true }), rm(notePath, { force: true }), rm(`${basePath}.md`, { force: true })]);
}

async function persistChromeAttachTarget(
  cwd: string | undefined,
  target: ChromeAttachTarget,
  force: boolean
): Promise<RegisterChromeAttachTargetResult> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  await mkdir(vault.chromeTargetsDir, { recursive: true });

  const basePath = path.join(vault.chromeTargetsDir, target.id);
  const jsonPath = `${basePath}.json`;
  const markdownPath = getChromeTargetNote(workspace, target).absolutePath;

  if (!force && (await fileExists(jsonPath))) {
    throw new Error(`Chrome attach target ${target.id} already exists. Re-run with --force to overwrite it.`);
  }

  await writeJsonFile(jsonPath, target);
  await writeFile(markdownPath, buildChromeAttachMarkdown(target), "utf8");

  return {
    target,
    markdownPath,
    jsonPath
  };
}

function buildChromeAttachMarkdown(target: ChromeAttachTarget): string {
    const title = normalizeObsidianText(target.name, target.id);
    const frontmatter =
      target.targetType === "profile"
      ? {
          type: "chrome-target",
          title,
          aliases: makeAliases(target.id),
          tags: makeTags("sourceloop", "chrome-target", target.targetType),
          mode: target.targetType,
          ...(target.description ? { description: target.description } : {}),
          created: target.createdAt,
          updated: target.createdAt
        }
      : {
          type: "chrome-target",
          title,
          aliases: makeAliases(target.id),
          tags: makeTags("sourceloop", "chrome-target", target.targetType),
          mode: target.targetType,
          ...(target.description ? { description: target.description } : {}),
          created: target.createdAt,
          updated: target.createdAt
        };

  return toFrontmatterMarkdown(frontmatter, buildChromeAttachBody(target));
}

function buildChromeAttachBody(target: ChromeAttachTarget): string {
  const lines = [
    `# ${normalizeObsidianText(target.name, target.id)}`,
    "",
    `- Target Type: ${target.targetType}`,
    `- Profile Isolation: ${target.profileIsolation}`,
    `- Ownership: ${target.ownership}`,
    `- NotebookLM Readiness: ${target.notebooklmReadiness}`
  ];

  if (target.notebooklmValidatedAt) {
    lines.push(`- NotebookLM Validated At: ${target.notebooklmValidatedAt}`);
  }

  if (target.targetType === "profile") {
    appendProfileBody(lines, target);
  } else {
    appendEndpointBody(lines, target);
  }

  if (target.description) {
    lines.push("", "## Description", target.description);
  }

  return lines.join("\n");
}

function appendProfileBody(lines: string[], target: ChromeProfileAttachTarget): void {
  lines.push(`- Profile Directory: ${target.profileDirPath}`);
  if (target.chromeExecutablePath) {
    lines.push(`- Chrome Executable: ${target.chromeExecutablePath}`);
  }
  if (target.currentProcessId) {
    lines.push(`- Current Process Id: ${target.currentProcessId}`);
  }
  if (target.remoteDebuggingPort) {
    lines.push(`- Preferred Remote Debugging Port: ${target.remoteDebuggingPort}`);
  }
  if (target.launchArgs.length > 0) {
    lines.push("", "## Launch Args", ...target.launchArgs.map((arg) => `- ${arg}`));
  }
}

function appendEndpointBody(lines: string[], target: ChromeEndpointAttachTarget): void {
  lines.push(`- Endpoint: ${target.endpoint}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
