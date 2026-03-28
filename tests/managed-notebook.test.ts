import * as fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerChromeEndpointTarget } from "../src/core/attach/manage-targets.js";
import {
  createManagedNotebook,
  importIntoManagedNotebook,
  loadManagedNotebookImport,
  loadManagedNotebookSetup
} from "../src/core/notebooks/manage-managed-notebooks.js";
import type { ManagedNotebookBrowserImportInput, NotebookBrowserSession, NotebookBrowserSessionFactory } from "../src/core/notebooklm/browser-agent.js";
import { createQuestionPlan } from "../src/core/runs/question-planner.js";
import { createTopic, loadTopic } from "../src/core/topics/manage-topics.js";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
import { ingestSource } from "../src/core/ingest/ingest-source.js";

describe("managed notebook ingestion", () => {
  it("creates managed notebook setup metadata and a normal notebook binding", async () => {
    const workspaceRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Managed setup topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Managed Setup Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    const result = await createManagedNotebook({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      name: "Managed Setup Notebook",
      attachTargetId: attachTarget.target.id,
      sessionFactory: createManagedSessionFactory({
        createdNotebookUrl: "https://notebooklm.google.com/notebook/managed-setup"
      })
    });

    const setupRecord = await loadManagedNotebookSetup(result.setup.id, workspaceRoot);
    const setupMarkdown = await fsPromises.readFile(result.setupMarkdownPath, "utf8");

    expect(result.binding.topicId).toBe(topic.topic.id);
    expect(result.binding.attachTargetId).toBe(attachTarget.target.id);
    expect(setupRecord.setup.notebookBindingId).toBe(result.binding.id);
    expect(setupMarkdown).toContain("type: managed-notebook-setup");
    expect(setupMarkdown).toContain("[[topics/");
    expect(setupMarkdown).toContain("[[notebooks/");
    expect(setupMarkdown).toContain("[[chrome-targets/");
  });

  it("counts imported managed notebook evidence for readiness and planning, but rejects queued imports", async () => {
    const workspaceRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Managed evidence topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Managed Evidence Chrome",
      endpoint: "http://127.0.0.1:9222"
    });
    const managedNotebook = await createManagedNotebook({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      name: "Managed Evidence Notebook",
      attachTargetId: attachTarget.target.id,
      sessionFactory: createManagedSessionFactory({
        createdNotebookUrl: "https://notebooklm.google.com/notebook/managed-evidence"
      })
    });

    await importIntoManagedNotebook({
      cwd: workspaceRoot,
      notebookBindingId: managedNotebook.binding.id,
      url: "https://youtube.com/watch?v=queued",
      sessionFactory: createManagedSessionFactory({
        importResults: [{ status: "queued" }]
      })
    });

    let refreshed = await loadTopic(topic.topic.id, workspaceRoot);
    expect(refreshed.topic.status).toBe("collecting_sources");
    expect(refreshed.corpus.managedNotebookImportIds).toHaveLength(0);

    await expect(
      createQuestionPlan({
        cwd: workspaceRoot,
        topicId: topic.topic.id
      })
    ).rejects.toThrow(/managed sources|declared evidence/i);

    await importIntoManagedNotebook({
      cwd: workspaceRoot,
      notebookBindingId: managedNotebook.binding.id,
      url: "https://youtube.com/watch?v=imported",
      title: "Imported YouTube Evidence",
      sessionFactory: createManagedSessionFactory({
        importResults: [{ status: "imported" }]
      })
    });

    refreshed = await loadTopic(topic.topic.id, workspaceRoot);
    expect(refreshed.topic.status).toBe("ready_for_planning");
    expect(refreshed.corpus.managedNotebookImportIds).toHaveLength(1);

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      maxQuestions: 1
    });

    expect(plan.batch.questions).toHaveLength(1);
  });

  it("imports local source artifacts into managed notebooks and persists lifecycle status", async () => {
    const workspaceRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Managed local import topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Managed Local Import Chrome",
      endpoint: "http://127.0.0.1:9222"
    });
    const managedNotebook = await createManagedNotebook({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      name: "Managed Local Import Notebook",
      attachTargetId: attachTarget.target.id,
      sessionFactory: createManagedSessionFactory({
        createdNotebookUrl: "https://notebooklm.google.com/notebook/managed-local-import"
      })
    });

    const sourcePath = path.join(workspaceRoot, "managed-local-source.md");
    await fsPromises.writeFile(sourcePath, "Managed notebook local source.", "utf8");
    const ingested = await ingestSource({
      cwd: workspaceRoot,
      input: sourcePath,
      topicId: topic.topic.id
    });

    const result = await importIntoManagedNotebook({
      cwd: workspaceRoot,
      notebookBindingId: managedNotebook.binding.id,
      sourceId: ingested.source.id,
      sessionFactory: createManagedSessionFactory({
        importResults: [{ status: "imported" }]
      })
    });

    const persisted = await loadManagedNotebookImport(result.managedImport.id, workspaceRoot);
    const markdown = await fsPromises.readFile(result.markdownPath, "utf8");

    expect(persisted.managedImport.sourceId).toBe(ingested.source.id);
    expect(persisted.managedImport.status).toBe("imported");
    expect(markdown).toContain("type: managed-notebook-import");
    expect(markdown).toContain("[[sources/");
  });

  it("rolls back the created binding if managed setup persistence fails", async () => {
    const workspaceRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Managed rollback topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Managed Rollback Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    await expect(
      createManagedNotebook({
        cwd: workspaceRoot,
        topicId: topic.topic.id,
        name: "Managed Rollback Notebook",
        attachTargetId: attachTarget.target.id,
        sessionFactory: createManagedSessionFactory({
          createdNotebookUrl: "https://notebooklm.google.com/notebook/managed-rollback"
        }),
        async writeSetupMarkdown() {
          throw new Error("setup note write failed");
        }
      })
    ).rejects.toThrow(/setup note write failed/);

    expect(await fsPromises.readdir(path.join(workspaceRoot, "vault", "notebooks"))).toHaveLength(0);
    expect(await fsPromises.readdir(path.join(workspaceRoot, "vault", "notebook-setups"))).toHaveLength(0);
  });

});

function createManagedSessionFactory(options: {
  createdNotebookUrl?: string;
  importResults?: ManagedImportResult[];
}): NotebookBrowserSessionFactory {
  let importIndex = 0;

  return {
    async createSession(): Promise<NotebookBrowserSession> {
      return {
        async preflight() {},
        async askQuestion() {
          throw new Error("askQuestion is not used in managed notebook tests");
        },
        async captureLatestAnswer() {
          throw new Error("captureLatestAnswer is not used in managed notebook tests");
        },
        async createNotebook() {
          return {
            notebookUrl: options.createdNotebookUrl ?? "https://notebooklm.google.com/notebook/managed-default"
          };
        },
        async importSource(_input: ManagedNotebookBrowserImportInput) {
          const result = options.importResults?.[importIndex] ?? { status: "imported" as const };
          importIndex += 1;
          return result;
        },
        async close() {}
      };
    }
  };
}

type ManagedImportResult = {
  status: "queued" | "imported" | "failed";
  failureReason?: string;
};
