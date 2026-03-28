import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCommand } from "../src/commands/init.js";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
import { loadWorkspace } from "../src/core/workspace/load-workspace.js";

describe("initializeWorkspace", () => {
  afterEach(() => {
    process.chdir("/Users/twlee/projects/SourceLoop");
  });

  it("creates the SourceLoop workspace layout and config", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));

    const result = await initializeWorkspace({
      directory: tempRoot,
      force: false
    });

    expect(await realpath(result.rootDir)).toBe(await realpath(tempRoot));

    const configRaw = await readFile(path.join(tempRoot, ".sourceloop/config.json"), "utf8");
    const config = JSON.parse(configRaw) as { version: number; paths: Record<string, string> };

    expect(config.version).toBe(1);
    expect(config.paths.chromeProfiles).toBe(".sourceloop/chrome-profiles");
    expect(config.paths.chromeTargets).toBe("vault/chrome-targets");
    expect(config.paths.topics).toBe("vault/topics");
    expect(config.paths.sources).toBe("vault/sources");
    expect(config.paths.notebookSources).toBe("vault/notebook-sources");
    expect(config.paths.notebookSetups).toBe("vault/notebook-setups");
    expect(config.paths.notebookImports).toBe("vault/notebook-imports");
    expect(config.paths.notebooks).toBe("vault/notebooks");
    expect(config.paths.bundles).toBe("vault/bundles");
    expect(config.paths.runs).toBe("vault/runs");
    expect(config.paths.outputs).toBe("vault/outputs");
  });

  it("supports current-directory initialization and Codex bootstrap generation", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    process.chdir(tempRoot);

    const output = await captureStdout(() => initCommand.parseAsync(["--ai", "codex", "--json"], { from: "user" }));
    const result = JSON.parse(output) as {
      rootDir: string;
      bootstrap?: { ai: string; created: string[] };
    };

    expect(await realpath(result.rootDir)).toBe(await realpath(tempRoot));
    expect(result.bootstrap).toMatchObject({
      ai: "codex"
    });

    const skillMarkdown = await readFile(
      path.join(tempRoot, ".codex/skills/sourceloop-operator/SKILL.md"),
      "utf8"
    );
    const playbookReference = await readFile(
      path.join(tempRoot, ".codex/skills/sourceloop-operator/references/playbook.md"),
      "utf8"
    );

    expect(skillMarkdown).toContain("name: sourceloop-operator");
    expect(skillMarkdown).toContain("status --json");
    expect(skillMarkdown).toContain("topic only");
    expect(skillMarkdown).toContain("no topic provided");
    expect(skillMarkdown).toContain("ask which topic to research");
    expect(skillMarkdown).toContain("Do not autonomously search the web or choose source materials");
    expect(skillMarkdown).toContain("Do not silently fall back to another Chrome session");
    expect(skillMarkdown).toContain("Ask the user before continuing with a non-SourceLoop browser");
    expect(skillMarkdown).toContain("trusted isolated Chrome target");
    expect(playbookReference).toContain("chrome launch");
    expect(playbookReference).toContain("existing NotebookLM URL");
    expect(playbookReference).toContain("SourceLoop-managed isolated profile");
    expect(playbookReference).toContain("If the user did not provide a topic, ask for the topic first");
    expect(playbookReference).toContain("do not silently continue on that path");
    expect(playbookReference).toContain("visible setup step");
  });

  it("adds Codex bootstrap to an existing workspace without rewriting config", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));

    await initializeWorkspace({
      directory: tempRoot,
      force: false
    });

    const configPath = path.join(tempRoot, ".sourceloop/config.json");
    const originalConfig = await readFile(configPath, "utf8");

    const result = await initializeWorkspace({
      directory: tempRoot,
      force: false,
      ai: "codex"
    });

    expect(result.bootstrap?.ai).toBe("codex");
    expect(await readFile(configPath, "utf8")).toBe(originalConfig);
    expect(await readFile(path.join(tempRoot, ".codex/skills/sourceloop-operator/SKILL.md"), "utf8")).toContain(
      "name: sourceloop-operator"
    );
  });

  it("overwrites the generated Codex scaffold only when forced", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));

    await initializeWorkspace({
      directory: tempRoot,
      force: false,
      ai: "codex"
    });

    const skillPath = path.join(tempRoot, ".codex/skills/sourceloop-operator/SKILL.md");
    const stalePath = path.join(tempRoot, ".codex/skills/sourceloop-operator/stale.txt");
    await writeFile(skillPath, "stale skill", "utf8");
    await writeFile(stalePath, "stale file", "utf8");

    await expect(
      initializeWorkspace({
        directory: tempRoot,
        force: false,
        ai: "codex"
      })
    ).rejects.toThrow(/Codex bootstrap already exists/i);

    const forced = await initializeWorkspace({
      directory: tempRoot,
      force: true,
      ai: "codex"
    });

    expect(forced.bootstrap?.ai).toBe("codex");
    expect(await readFile(skillPath, "utf8")).toContain("name: sourceloop-operator");
    await expect(readFile(stalePath, "utf8")).rejects.toThrow();
  });

  it("fails before writing config when a conflicting Codex scaffold already exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await mkdir(path.join(tempRoot, ".codex/skills/sourceloop-operator"), { recursive: true });
    await writeFile(path.join(tempRoot, ".codex/skills/sourceloop-operator/SKILL.md"), "existing", "utf8");

    await expect(
      initializeWorkspace({
        directory: tempRoot,
        force: false,
        ai: "codex"
      })
    ).rejects.toThrow(/Codex bootstrap already exists/i);

    await expect(readFile(path.join(tempRoot, ".sourceloop/config.json"), "utf8")).rejects.toThrow();
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
    expect(workspace.config.paths.chromeProfiles).toBe(".sourceloop/chrome-profiles");
    expect(workspace.config.paths.topics).toBe("vault/topics");
    expect(workspace.config.paths.sources).toBe("vault/sources");
    expect(workspace.config.paths.notebookSources).toBe("vault/notebook-sources");
    expect(workspace.config.paths.notebookSetups).toBe("vault/notebook-setups");
    expect(workspace.config.paths.notebookImports).toBe("vault/notebook-imports");
  });
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}
