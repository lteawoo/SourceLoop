import * as fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadChromeAttachTarget, registerChromeEndpointTarget } from "../src/core/attach/manage-targets.js";
import {
  createManagedNotebook,
  importIntoManagedNotebook,
  loadManagedNotebookImport,
  loadManagedNotebookSetup,
  loadManagedNotebookSetupByBindingId
} from "../src/core/notebooks/manage-managed-notebooks.js";
import { bindNotebook } from "../src/core/notebooks/bind-notebook.js";
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
        createdNotebookUrl: "https://notebooklm.google.com/notebook/managed-setup?addSource=true"
      })
    });

    const setupRecord = await loadManagedNotebookSetup(result.setup.id, workspaceRoot);
    const reloadedAttachTarget = await loadChromeAttachTarget(attachTarget.target.id, workspaceRoot);
    const setupMarkdown = await fsPromises.readFile(result.setupMarkdownPath, "utf8");

    expect(result.binding.id).toBe("notebook-managed-setup");
    expect(result.binding.topicId).toBe(topic.topic.id);
    expect(result.binding.attachTargetId).toBe(attachTarget.target.id);
    expect(result.binding.notebookUrl).toBe("https://notebooklm.google.com/notebook/managed-setup");
    expect(result.binding.remoteNotebookId).toBe("managed-setup");
    expect(result.setup.id).toBe("managed-notebook-setup-managed-setup");
    expect(result.setup.remoteNotebookId).toBe("managed-setup");
    expect(result.setup.name).toBe("Managed Setup Notebook");
    expect(setupRecord.setup.notebookBindingId).toBe(result.binding.id);
    expect(reloadedAttachTarget.target.notebooklmReadiness).toBe("validated");
    expect(reloadedAttachTarget.target.notebooklmValidatedAt).toBeDefined();
    expect(setupMarkdown).toContain("type: managed-notebook-setup");
    expect(setupMarkdown).toContain("[[topics/");
    expect(setupMarkdown).toContain("[[notebooks/");
    expect(setupMarkdown).toContain("[[chrome-targets/");
  });

  it("keeps legacy name-based managed setups recoverable through remote notebook id matching", async () => {
    const workspaceRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Legacy managed setup topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Legacy managed Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    const legacyBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Legacy Managed Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/legacy-remote-id",
      accessMode: "owner"
    });

    await fsPromises.writeFile(
      path.join(workspaceRoot, "vault", "notebook-setups", "managed-notebook-setup-topic-legacy-managed-setup-topic-legacy-managed-notebook.json"),
      JSON.stringify(
        {
          id: "managed-notebook-setup-topic-legacy-managed-setup-topic-legacy-managed-notebook",
          type: "managed_notebook_setup",
          topicId: topic.topic.id,
          notebookBindingId: legacyBinding.binding.id,
          attachTargetId: attachTarget.target.id,
          createdAt: "2026-03-28T00:00:00.000Z",
          updatedAt: "2026-03-28T00:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const repairedBinding = await bindNotebook({
      cwd: workspaceRoot,
      id: "notebook-legacy-remote-id",
      name: "Renamed Managed Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/legacy-remote-id",
      accessMode: "owner",
      force: true
    });

    const recovered = await loadManagedNotebookSetupByBindingId(repairedBinding.binding.id, workspaceRoot);

    expect(recovered.setup.id).toBe("managed-notebook-setup-topic-legacy-managed-setup-topic-legacy-managed-notebook");
    expect(recovered.setup.notebookBindingId).toBe(repairedBinding.binding.id);
    expect(recovered.setup.remoteNotebookId).toBe("legacy-remote-id");
    expect(recovered.setup.name).toBe("Renamed Managed Notebook");

    await fsPromises.rm(path.join(workspaceRoot, "vault", "notebooks", `${legacyBinding.binding.id}.json`), { force: true });
    await fsPromises.rm(legacyBinding.markdownPath, { force: true });

    const recoveredAfterLegacyRemoval = await loadManagedNotebookSetupByBindingId(repairedBinding.binding.id, workspaceRoot);
    expect(recoveredAfterLegacyRemoval.setup.notebookBindingId).toBe(repairedBinding.binding.id);
    expect(recoveredAfterLegacyRemoval.setup.remoteNotebookId).toBe("legacy-remote-id");
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

  it("allows AI-default planning when notebook summary context proves the managed notebook already has usable source content", async () => {
    const workspaceRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Summary-backed managed evidence topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Summary-backed managed Chrome",
      endpoint: "http://127.0.0.1:9222"
    });
    const managedNotebook = await createManagedNotebook({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      name: "Summary-backed managed notebook",
      attachTargetId: attachTarget.target.id,
      sessionFactory: createManagedSessionFactory({
        createdNotebookUrl: "https://notebooklm.google.com/notebook/summary-backed-managed"
      })
    });

    await importIntoManagedNotebook({
      cwd: workspaceRoot,
      notebookBindingId: managedNotebook.binding.id,
      url: "https://youtube.com/watch?v=queued-summary-backed",
      sessionFactory: createManagedSessionFactory({
        importResults: [{ status: "queued" }]
      })
    });

    const refreshed = await loadTopic(topic.topic.id, workspaceRoot);
    expect(refreshed.topic.status).toBe("collecting_sources");
    expect(refreshed.corpus.managedNotebookImportIds).toHaveLength(0);

    const originalPlannerCommand = process.env.SOURCELOOP_QUESTION_PLANNER_CMD;
    process.env.SOURCELOOP_QUESTION_PLANNER_CMD = "this-env-should-not-be-used";

    try {
      const plan = await createQuestionPlan({
        cwd: workspaceRoot,
        topicId: topic.topic.id,
        maxQuestions: 1,
        requireAiPlanner: true,
        planningSnapshot: {
          notebookTitle: "Summary-backed managed notebook",
          sourceCount: 1,
          summary: "NotebookLM already exposed a summary for the queued managed import."
        },
        questionPlanner: async () => [
          {
            objective: "Summary-backed planning objective",
            prompt: "What does the notebook summary emphasize?"
          }
        ]
      });

      expect(plan.batch.planningMode).toBe("ai_default");
      expect(plan.planningContext?.notebookTitle).toBe("Summary-backed managed notebook");
      expect(plan.planningContext?.summary).toContain("NotebookLM already exposed a summary");
      expect(plan.batch.questions).toHaveLength(1);
    } finally {
      if (originalPlannerCommand === undefined) {
        delete process.env.SOURCELOOP_QUESTION_PLANNER_CMD;
      } else {
        process.env.SOURCELOOP_QUESTION_PLANNER_CMD = originalPlannerCommand;
      }
    }
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
    const reloadedAttachTarget = await loadChromeAttachTarget(attachTarget.target.id, workspaceRoot);
    const markdown = await fsPromises.readFile(result.markdownPath, "utf8");

    expect(persisted.managedImport.sourceId).toBe(ingested.source.id);
    expect(persisted.managedImport.status).toBe("imported");
    expect(reloadedAttachTarget.target.notebooklmReadiness).toBe("validated");
    expect(markdown).toContain("type: managed-notebook-import");
    expect(markdown).toContain("[[sources/");
  });

  it("treats queued managed imports as NotebookLM validation for the attach target", async () => {
    const workspaceRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Managed queued import topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Managed Queued Import Chrome",
      endpoint: "http://127.0.0.1:9222"
    });
    const managedNotebook = await createManagedNotebook({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      name: "Managed Queued Import Notebook",
      attachTargetId: attachTarget.target.id,
      sessionFactory: createManagedSessionFactory({
        createdNotebookUrl: "https://notebooklm.google.com/notebook/managed-queued-import"
      })
    });

    const resetTarget = await loadChromeAttachTarget(attachTarget.target.id, workspaceRoot);
    await fsPromises.writeFile(
      resetTarget.path,
      JSON.stringify(
        {
          ...resetTarget.target,
          notebooklmReadiness: "unknown",
          notebooklmValidatedAt: undefined
        },
        null,
        2
      ),
      "utf8"
    );

    await importIntoManagedNotebook({
      cwd: workspaceRoot,
      notebookBindingId: managedNotebook.binding.id,
      url: "https://youtube.com/watch?v=queued-validation",
      sessionFactory: createManagedSessionFactory({
        importResults: [{ status: "queued" }]
      })
    });

    const reloadedAttachTarget = await loadChromeAttachTarget(attachTarget.target.id, workspaceRoot);
    expect(reloadedAttachTarget.target.notebooklmReadiness).toBe("validated");
    expect(reloadedAttachTarget.target.notebooklmValidatedAt).toBeDefined();
  });

  it("passes the canonical notebook URL into the first managed import and derives a usable YouTube title", async () => {
    const workspaceRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Managed first import topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Managed First Import Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    let observedImportInput: ManagedNotebookBrowserImportInput | undefined;
    const managedNotebook = await createManagedNotebook({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      name: "Managed First Import Notebook",
      attachTargetId: attachTarget.target.id,
      sessionFactory: createManagedSessionFactory({
        createdNotebookUrl: "https://notebooklm.google.com/notebook/managed-first-import?addSource=true"
      })
    });

    const result = await importIntoManagedNotebook({
      cwd: workspaceRoot,
      notebookBindingId: managedNotebook.binding.id,
      url: "https://www.youtube.com/watch?v=eMlx5fFNoYc",
      sessionFactory: createManagedSessionFactory({
        importResults: [{ status: "imported" }],
        onImport(input) {
          observedImportInput = input;
        }
      })
    });

    expect(managedNotebook.binding.notebookUrl).toBe("https://notebooklm.google.com/notebook/managed-first-import");
    expect(observedImportInput).toMatchObject({
      notebookUrl: "https://notebooklm.google.com/notebook/managed-first-import",
      importKind: "youtube_url",
      title: "eMlx5fFNoYc",
      url: "https://www.youtube.com/watch?v=eMlx5fFNoYc"
    });
    expect(result.managedImport.title).toBe("eMlx5fFNoYc");
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
  onImport?: (input: ManagedNotebookBrowserImportInput) => void;
}): NotebookBrowserSessionFactory {
  let importIndex = 0;

  return {
    async createSession(): Promise<NotebookBrowserSession> {
      return {
        async preflight() {},
        async capturePlanningSnapshot() {
          return {
            notebookTitle: "Managed Notebook",
            sourceCount: 1,
            summary: "Managed notebook summary."
          };
        },
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
        async importSource(input: ManagedNotebookBrowserImportInput) {
          options.onImport?.(input);
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
