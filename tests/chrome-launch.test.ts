import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { launchManagedChrome } from "../src/core/attach/launch-managed-chrome.js";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
import { registerChromeEndpointTarget } from "../src/core/attach/manage-targets.js";

describe("managed chrome launch", () => {
  it("creates a SourceLoop-managed isolated attach target and workspace-local profile", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const spawned: Array<{ executablePath: string; args: string[] }> = [];
    const result = await launchManagedChrome(
      {
        cwd: workspaceRoot,
        name: "Research Chrome"
      },
      {
        resolveChromeExecutablePath: async () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        allocateFreePort: async () => 9333,
        waitForRemoteDebuggingEndpoint: async () => undefined,
        spawnChromeProcess(executablePath, args) {
          spawned.push({ executablePath, args });
          return {
            kill() {
              return true;
            },
            unref() {
              return undefined;
            }
          };
        }
      }
    );

    const markdown = await readFile(result.markdownPath, "utf8");

    expect(result.target.id).toBe("attach-research-chrome");
    expect(result.target.targetType).toBe("profile");
    expect(result.target.profileIsolation).toBe("isolated");
    expect(result.target.ownership).toBe("sourceloop_managed");
    expect(result.target.notebooklmReadiness).toBe("unknown");
    expect(result.profileDirPath).toBe(path.join(workspaceRoot, ".sourceloop", "chrome-profiles", "research-chrome"));
    expect(result.endpoint).toBe("http://127.0.0.1:9333");
    expect(result.launched).toBe(true);
    expect(result.reusedTarget).toBe(false);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args).toContain(`--user-data-dir=${result.profileDirPath}`);
    expect(markdown).toContain("Profile Isolation: isolated");
    expect(markdown).toContain("Ownership: sourceloop_managed");
  });

  it("reuses an existing managed launch target without spawning a second Chrome when its endpoint is already ready", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    let spawnCount = 0;
    const deps = {
      resolveChromeExecutablePath: async () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      allocateFreePort: async () => 9444,
      waitForRemoteDebuggingEndpoint: async () => undefined,
      spawnChromeProcess() {
        spawnCount += 1;
        return {
          kill() {
            return true;
          },
          unref() {
            return undefined;
          }
        };
      }
    };

    const first = await launchManagedChrome(
      {
        cwd: workspaceRoot,
        name: "Research Chrome"
      },
      deps
    );
    const second = await launchManagedChrome(
      {
        cwd: workspaceRoot,
        name: "Research Chrome"
      },
      deps
    );

    expect(spawnCount).toBe(1);
    expect(first.target.id).toBe(second.target.id);
    expect(second.launched).toBe(false);
    expect(second.reusedTarget).toBe(true);
    expect(second.profileDirPath).toBe(first.profileDirPath);
  });

  it("does not overwrite an existing non-managed attach target with the same id unless forced", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Research Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    await expect(
      launchManagedChrome(
        {
          cwd: workspaceRoot,
          name: "Research Chrome"
        },
        {
          resolveChromeExecutablePath: async () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          allocateFreePort: async () => 9666,
          waitForRemoteDebuggingEndpoint: async () => undefined,
          spawnChromeProcess() {
            return {
              kill() {
                return true;
              },
              unref() {
                return undefined;
              }
            };
          }
        }
      )
    ).rejects.toThrow(/already exists and is not a SourceLoop-managed isolated profile/i);
  });
});
