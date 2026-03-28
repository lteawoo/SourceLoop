import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { getVaultPaths } from "../vault/paths.js";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { slugify } from "../../lib/slugify.js";
import {
  loadChromeAttachTarget,
  registerChromeProfileTarget,
  type RegisterChromeAttachTargetResult,
  upsertChromeAttachTarget
} from "./manage-targets.js";
import {
  allocateFreePort,
  resolveChromeExecutablePath,
  waitForRemoteDebuggingEndpoint
} from "../notebooklm/browser-agent.js";
import type { ChromeAttachTarget, ChromeNotebooklmReadiness, ChromeProfileAttachTarget } from "../../schemas/attach.js";

export type LaunchManagedChromeInput = {
  name?: string;
  chromeExecutablePath?: string;
  remoteDebuggingPort?: number;
  launchArgs?: string[];
  description?: string;
  force?: boolean;
  cwd?: string;
};

export type LaunchManagedChromeResult = RegisterChromeAttachTargetResult & {
  endpoint: string;
  profileDirPath: string;
  launched: boolean;
  reusedTarget: boolean;
};

export type CloseManagedChromeResult = {
  targetId: string;
  closed: boolean;
  processId?: number;
};

type SpawnedChromeProcess = Pick<ChildProcess, "kill" | "unref" | "pid">;

type LaunchManagedChromeDeps = {
  resolveChromeExecutablePath: typeof resolveChromeExecutablePath;
  allocateFreePort: typeof allocateFreePort;
  waitForRemoteDebuggingEndpoint: typeof waitForRemoteDebuggingEndpoint;
  spawnChromeProcess: (executablePath: string, args: string[]) => SpawnedChromeProcess;
};

type CloseManagedChromeDeps = {
  loadChromeAttachTarget: typeof loadChromeAttachTarget;
  upsertChromeAttachTarget: typeof upsertChromeAttachTarget;
  findRunningProcessId: (target: ChromeProfileAttachTarget) => Promise<number | undefined>;
  terminateProcess: (processId: number) => Promise<boolean>;
};

const execFileAsync = promisify(execFile);

const defaultDeps: LaunchManagedChromeDeps = {
  resolveChromeExecutablePath,
  allocateFreePort,
  waitForRemoteDebuggingEndpoint,
  spawnChromeProcess(executablePath, args) {
    return spawn(executablePath, args, {
      detached: true,
      stdio: "ignore"
    });
  }
};

const defaultCloseDeps: CloseManagedChromeDeps = {
  loadChromeAttachTarget,
  upsertChromeAttachTarget,
  findRunningProcessId: findManagedChromeProcessId,
  terminateProcess: terminateManagedChromeProcess
};

export async function launchManagedChrome(
  input: LaunchManagedChromeInput,
  deps: LaunchManagedChromeDeps = defaultDeps
): Promise<LaunchManagedChromeResult> {
  const workspace = await loadWorkspace(input.cwd);
  const vault = getVaultPaths(workspace);
  const name = input.name?.trim() || "research-browser";
  const slug = slugify(name) || "research-browser";
  const profileDirPath = path.join(vault.chromeProfilesDir, slug);
  const targetId = `attach-${slug}`;

  await mkdir(vault.chromeProfilesDir, { recursive: true });
  await mkdir(profileDirPath, { recursive: true });

  const existingTarget = await loadExistingTarget(targetId, workspace.rootDir);
  if (existingTarget && !isSourceLoopManagedLaunchTarget(existingTarget.target) && !input.force) {
    throw new Error(
      `Attach target ${targetId} already exists and is not a SourceLoop-managed isolated profile. Re-run with --force to replace it.`
    );
  }

  const reusableTarget = existingTarget && isSourceLoopManagedLaunchTarget(existingTarget.target)
    ? existingTarget.target
    : undefined;

  const executablePath = await deps.resolveChromeExecutablePath(
    input.chromeExecutablePath ?? reusableTarget?.chromeExecutablePath
  );
  const remoteDebuggingPort =
    input.remoteDebuggingPort ??
    reusableTarget?.remoteDebuggingPort ??
    (await deps.allocateFreePort());
  const endpoint = `http://127.0.0.1:${remoteDebuggingPort}`;

  if (reusableTarget && !input.force) {
    try {
      await deps.waitForRemoteDebuggingEndpoint(endpoint, 750);
      const persisted = await registerChromeProfileTarget(
        buildRegisterInput({
          cwd: workspace.rootDir,
          name,
          profileDirPath,
          executablePath,
          remoteDebuggingPort,
          launchArgs: input.launchArgs ?? reusableTarget.launchArgs,
          description: input.description ?? reusableTarget.description,
          createdAt: reusableTarget.createdAt,
          currentProcessId:
            reusableTarget.currentProcessId ?? (await findManagedChromeProcessId(reusableTarget)),
          notebooklmReadiness: reusableTarget.notebooklmReadiness,
          notebooklmValidatedAt: reusableTarget.notebooklmValidatedAt,
          force: true
        })
      );

      return {
        ...persisted,
        endpoint,
        profileDirPath,
        launched: false,
        reusedTarget: true
      };
    } catch {
      // endpoint not already serving this target; continue to launch
    }
  }

  const launchArgs = [
    `--user-data-dir=${profileDirPath}`,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(input.launchArgs ?? reusableTarget?.launchArgs ?? []),
    "https://notebooklm.google.com/"
  ];

  const processHandle = deps.spawnChromeProcess(executablePath, launchArgs);

  try {
    await deps.waitForRemoteDebuggingEndpoint(endpoint, 15_000);
  } catch (error) {
    processHandle.kill("SIGTERM");
    throw error;
  }

  processHandle.unref?.();

  const persisted = await registerChromeProfileTarget(
    buildRegisterInput({
      cwd: workspace.rootDir,
      name,
      profileDirPath,
      executablePath,
      currentProcessId: toChildProcessId(processHandle.pid),
      remoteDebuggingPort,
      launchArgs: input.launchArgs ?? reusableTarget?.launchArgs,
      description: input.description ?? reusableTarget?.description,
      createdAt: reusableTarget?.createdAt,
      notebooklmReadiness: reusableTarget?.notebooklmReadiness,
      notebooklmValidatedAt: reusableTarget?.notebooklmValidatedAt,
      force: Boolean(existingTarget)
    })
  );

  return {
    ...persisted,
    endpoint,
    profileDirPath,
    launched: true,
    reusedTarget: Boolean(reusableTarget)
  };
}

export async function closeManagedChrome(
  input: { targetId: string; cwd?: string },
  deps: CloseManagedChromeDeps = defaultCloseDeps
): Promise<CloseManagedChromeResult> {
  const { target } = await deps.loadChromeAttachTarget(input.targetId, input.cwd);

  if (!isSourceLoopManagedLaunchTarget(target)) {
    throw new Error(`Attach target ${input.targetId} is not a SourceLoop-managed isolated Chrome profile.`);
  }

  const processId = target.currentProcessId ?? (await deps.findRunningProcessId(target));
  const closed = processId ? await deps.terminateProcess(processId) : false;

  await deps.upsertChromeAttachTarget(
    stripCurrentProcessId(target),
    {
      force: true,
      ...(input.cwd ? { cwd: input.cwd } : {})
    }
  );

  return {
    targetId: target.id,
    closed,
    ...(processId ? { processId } : {})
  };
}

export async function closeManagedChromeIfOwnedTarget(
  input: { target: ChromeAttachTarget; cwd?: string },
  deps: CloseManagedChromeDeps = defaultCloseDeps
): Promise<void> {
  if (!isSourceLoopManagedLaunchTarget(input.target)) {
    return;
  }

  await closeManagedChrome(
    {
      targetId: input.target.id,
      ...(input.cwd ? { cwd: input.cwd } : {})
    },
    deps
  );
}

function isSourceLoopManagedLaunchTarget(target: ChromeAttachTarget): target is ChromeProfileAttachTarget {
  return target.targetType === "profile" && target.ownership === "sourceloop_managed" && target.profileIsolation === "isolated";
}

async function loadExistingTarget(
  targetId: string,
  cwd: string
): Promise<{ target: import("../../schemas/attach.js").ChromeAttachTarget } | undefined> {
  try {
    const loaded = await loadChromeAttachTarget(targetId, cwd);
    return { target: loaded.target };
  } catch {
    return undefined;
  }
}

function buildRegisterInput(input: {
  cwd: string;
  name: string;
  profileDirPath: string;
  executablePath: string;
  remoteDebuggingPort: number;
  launchArgs: string[] | undefined;
  description: string | undefined;
  createdAt: string | undefined;
  notebooklmReadiness: ChromeNotebooklmReadiness | undefined;
  notebooklmValidatedAt: string | undefined;
  currentProcessId: number | undefined;
  force: boolean;
}) {
  return {
    cwd: input.cwd,
    name: input.name,
    profileDirPath: input.profileDirPath,
    ownership: "sourceloop_managed" as const,
    profileIsolation: "isolated" as const,
    chromeExecutablePath: input.executablePath,
    ...(input.currentProcessId ? { currentProcessId: input.currentProcessId } : {}),
    remoteDebuggingPort: input.remoteDebuggingPort,
    ...(input.launchArgs ? { launchArgs: input.launchArgs } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.notebooklmReadiness ? { notebooklmReadiness: input.notebooklmReadiness } : {}),
    ...(input.notebooklmValidatedAt ? { notebooklmValidatedAt: input.notebooklmValidatedAt } : {}),
    force: input.force
  };
}

function toChildProcessId(processId: number | undefined): number | undefined {
  return typeof processId === "number" && Number.isInteger(processId) && processId > 0 ? processId : undefined;
}

function stripCurrentProcessId(target: ChromeProfileAttachTarget): ChromeProfileAttachTarget {
  const { currentProcessId: _currentProcessId, ...rest } = target;
  return rest;
}

async function findManagedChromeProcessId(target: ChromeProfileAttachTarget): Promise<number | undefined> {
  if (process.platform === "win32") {
    return target.currentProcessId;
  }

  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  const processArg = `--user-data-dir=${target.profileDirPath}`;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes(processArg)) {
      continue;
    }
    const match = trimmed.match(/^(\d+)\s+/);
    if (!match) {
      continue;
    }
    return Number(match[1]);
  }

  return undefined;
}

async function terminateManagedChromeProcess(processId: number): Promise<boolean> {
  if (!isProcessRunning(processId)) {
    return false;
  }

  process.kill(processId, "SIGTERM");
  if (await waitForProcessExit(processId, 5_000)) {
    return true;
  }

  if (!isProcessRunning(processId)) {
    return true;
  }

  process.kill(processId, "SIGKILL");
  return waitForProcessExit(processId, 2_000);
}

function isProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(processId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessRunning(processId)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return !isProcessRunning(processId);
}
