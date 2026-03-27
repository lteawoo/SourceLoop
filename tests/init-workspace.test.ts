import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
import { loadWorkspace } from "../src/core/workspace/load-workspace.js";

describe("initializeWorkspace", () => {
  it("creates the SourceLoop workspace layout and config", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));

    const result = await initializeWorkspace({
      directory: tempRoot,
      force: false
    });

    expect(result.rootDir).toBe(tempRoot);

    const configRaw = await readFile(path.join(tempRoot, ".sourceloop/config.json"), "utf8");
    const config = JSON.parse(configRaw) as { version: number; paths: Record<string, string> };

    expect(config.version).toBe(1);
    expect(config.paths.chromeTargets).toBe("vault/chrome-targets");
    expect(config.paths.topics).toBe("vault/topics");
    expect(config.paths.sources).toBe("vault/sources");
    expect(config.paths.notebooks).toBe("vault/notebooks");
    expect(config.paths.bundles).toBe("vault/bundles");
    expect(config.paths.runs).toBe("vault/runs");
    expect(config.paths.outputs).toBe("vault/outputs");
  });

  it("loads legacy workspace configs that do not yet include chromeTargets", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await mkdir(path.join(tempRoot, ".sourceloop"), { recursive: true });
    await writeFile(
      path.join(tempRoot, ".sourceloop/config.json"),
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          paths: {
            sources: "vault/sources",
            notebooks: "vault/notebooks",
            bundles: "vault/bundles",
            runs: "vault/runs",
            outputs: "vault/outputs"
          }
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const workspace = await loadWorkspace(tempRoot);

    expect(workspace.config.paths.chromeTargets).toBe("vault/chrome-targets");
    expect(workspace.config.paths.topics).toBe("vault/topics");
    expect(workspace.config.paths.sources).toBe("vault/sources");
  });
});
