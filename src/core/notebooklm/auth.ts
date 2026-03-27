import { access, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { NOTEBOOKLM_DEFAULT_URL } from "./config.js";

export type NotebookAuthProfileStatus = {
  profile: string;
  authenticated: boolean;
  stateFilePath: string;
  profileDirPath: string;
  stateAgeHours?: number;
};

export type SetupNotebookAuthInput = {
  profile?: string;
  cwd?: string;
  timeoutMinutes?: number;
};

export async function setupNotebookAuth(input: SetupNotebookAuthInput): Promise<NotebookAuthProfileStatus> {
  const workspace = await loadWorkspace(input.cwd);
  const profile = input.profile ?? "default";
  const paths = getNotebookAuthPaths(workspace.rootDir, profile);
  await mkdir(paths.profileDirPath, { recursive: true });

  const context = await chromium.launchPersistentContext(paths.profileDirPath, {
    channel: "chrome",
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ["--enable-automation"]
  });

  try {
    const page = await openNotebookPage(context, NOTEBOOKLM_DEFAULT_URL);
    await page.waitForURL(/^https:\/\/notebooklm\.google\.com\//, {
      timeout: (input.timeoutMinutes ?? 10) * 60 * 1000
    });

    await context.storageState({ path: paths.stateFilePath });
    await writeFile(paths.authInfoPath, JSON.stringify({ authenticatedAt: new Date().toISOString() }, null, 2) + "\n");

    return getNotebookAuthStatus({ rootDir: workspace.rootDir, profile });
  } finally {
    await context.close();
  }
}

async function openNotebookPage(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>, url: string) {
  let page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);

    if (!(error instanceof Error) || !error.message.includes("ERR_INVALID_ARGUMENT")) {
      throw error;
    }

    page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return page;
  }
}

export async function clearNotebookAuth(input: { profile?: string; cwd?: string }): Promise<NotebookAuthProfileStatus> {
  const workspace = await loadWorkspace(input.cwd);
  const profile = input.profile ?? "default";
  const paths = getNotebookAuthPaths(workspace.rootDir, profile);

  await rm(paths.profileRootPath, { recursive: true, force: true });
  return {
    profile,
    authenticated: false,
    stateFilePath: paths.stateFilePath,
    profileDirPath: paths.profileDirPath
  };
}

export async function getNotebookAuthStatus(input: {
  cwd?: string;
  rootDir?: string;
  profile?: string;
}): Promise<NotebookAuthProfileStatus> {
  const rootDir = input.rootDir ?? (await loadWorkspace(input.cwd)).rootDir;
  const profile = input.profile ?? "default";
  const paths = getNotebookAuthPaths(rootDir, profile);

  const exists = await fileExists(paths.stateFilePath);
  if (!exists) {
    return {
      profile,
      authenticated: false,
      stateFilePath: paths.stateFilePath,
      profileDirPath: paths.profileDirPath
    };
  }

  const stateStat = await stat(paths.stateFilePath);
  return {
    profile,
    authenticated: true,
    stateFilePath: paths.stateFilePath,
    profileDirPath: paths.profileDirPath,
    stateAgeHours: (Date.now() - stateStat.mtimeMs) / 1000 / 60 / 60
  };
}

export async function readNotebookStorageState(rootDir: string, profile: string): Promise<string> {
  const paths = getNotebookAuthPaths(rootDir, profile);
  await access(paths.stateFilePath);
  return paths.stateFilePath;
}

export function getNotebookAuthPaths(rootDir: string, profile: string) {
  const profileSlug = profile.trim() || "default";
  const baseDir = path.join(rootDir, ".sourceloop", "notebooklm", profileSlug);
  return {
    profile,
    profileRootPath: baseDir,
    profileDirPath: path.join(baseDir, "profile"),
    stateFilePath: path.join(baseDir, "state.json"),
    authInfoPath: path.join(baseDir, "auth-info.json")
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
