import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestSource } from "../src/core/ingest/ingest-source.js";
import { createTopic, loadTopic } from "../src/core/topics/manage-topics.js";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";

const servers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        })
    )
  );

  servers.clear();
});

describe("ingestSource", () => {
  it("ingests a local markdown file into the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const inputPath = path.join(workspaceRoot, "draft.md");
    await writeFile(inputPath, "SourceLoop local file body.", "utf8");

    const result = await ingestSource({
      input: inputPath,
      cwd: workspaceRoot
    });

    const written = await readFile(result.outputPath, "utf8");

    expect(result.source.type).toBe("file");
    expect(written).toContain("type: source");
    expect(written).toContain("tags:");
    expect(written).toContain("- file");
    expect(written).toContain("title: draft");
    expect(written).toContain("# draft");
    expect(written).toContain("SourceLoop local file body.");
  });

  it("ingests a URL into the workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const server = createServer((_, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <html lang="en">
          <head><title>NotebookLM Bundle Test</title></head>
          <body>
            <article>
              <p>First paragraph.</p>
              <p>Second paragraph.</p>
            </article>
          </body>
        </html>`);
    });

    servers.add(server);

    const port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        const address = server.address();

        if (address && typeof address === "object") {
          resolve(address.port);
        }
      });
    });

    const result = await ingestSource({
      input: `http://127.0.0.1:${port}/article`,
      cwd: workspaceRoot
    });

    const written = await readFile(result.outputPath, "utf8");

    expect(result.source.type).toBe("url");
    expect(written).toContain("type: source");
    expect(written).toContain("- url");
    expect(written).toContain('title: "NotebookLM Bundle Test"');
    expect(written).toContain("# NotebookLM Bundle Test");
    expect(written).toContain("First paragraph.");
    expect(written).toContain("Second paragraph.");
  });

  it("links an ingested source into a topic corpus", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "AI agents market",
      goal: "Understand the market structure",
      intendedOutput: "lecture outline"
    });

    const inputPath = path.join(workspaceRoot, "topic-source.md");
    await writeFile(inputPath, "Topic-linked source body.", "utf8");

    const result = await ingestSource({
      input: inputPath,
      topicId: topic.topic.id,
      cwd: workspaceRoot
    });

    const written = await readFile(result.outputPath, "utf8");
    const refreshed = await loadTopic(topic.topic.id, workspaceRoot);

    expect(result.source.topicId).toBe(topic.topic.id);
    expect(written).toContain(`topic_id: ${topic.topic.id}`);
    expect(refreshed.topic.status).toBe("collecting_sources");
    expect(refreshed.corpus.sourceIds).toContain(result.source.id);
  });

  it("supports creating a topic without explicit goal or output hints", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "General web design research"
    });

    const refreshed = await loadTopic(topic.topic.id, workspaceRoot);

    expect(refreshed.topic.goal).toBeUndefined();
    expect(refreshed.topic.intendedOutput).toBeUndefined();
    expect(refreshed.topic.status).toBe("initialized");
  });
});
