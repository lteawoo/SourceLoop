import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listChromeAttachTargets,
  loadChromeAttachTarget,
  registerChromeEndpointTarget,
  registerChromeProfileTarget
} from "../src/core/attach/manage-targets.js";
import { bindNotebook } from "../src/core/notebooks/bind-notebook.js";
import { BrowserAgentNotebookRunnerAdapter } from "../src/core/notebooklm/browser-agent-adapter.js";
import {
  ChromeAttachValidationError,
  disposeNotebookBrowserSessionResources,
  validateChromeAttachTarget,
  type NotebookBrowserSession,
  type NotebookBrowserSessionFactory
} from "../src/core/notebooklm/browser-agent.js";
import { createQuestionPlan } from "../src/core/runs/question-planner.js";
import { executeQARun } from "../src/core/runs/run-qa.js";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
import type { ChromeAttachTarget } from "../src/schemas/attach.js";
import type { PlannedQuestion } from "../src/schemas/run.js";
import { getExchangeNote } from "../src/core/vault/notes.js";
import { loadWorkspace } from "../src/core/workspace/load-workspace.js";

describe("Chrome attach targets", () => {
  it("disconnects user-owned endpoint sessions without killing the browser process", async () => {
    let pageClosed = false;
    let browserClosed = false;
    let processKilled = false;

    await disposeNotebookBrowserSessionResources({
      closePage: async () => {
        pageClosed = true;
      },
      closeBrowserConnection: async () => {
        browserClosed = true;
      },
      ownsBrowserProcess: false,
      killSpawnedProcess: () => {
        processKilled = true;
      }
    });

    expect(pageClosed).toBe(true);
    expect(browserClosed).toBe(true);
    expect(processKilled).toBe(false);
  });

  it("registers inspectable profile and endpoint attach targets", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const profileTarget = await registerChromeProfileTarget({
      cwd: workspaceRoot,
      name: "Primary Chrome",
      profileDirPath: path.join(workspaceRoot, "chrome-profile"),
      launchArgs: ["--lang=en-US"]
    });
    const endpointTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Debug Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    const targets = await listChromeAttachTargets(workspaceRoot);
    const loadedProfile = await loadChromeAttachTarget(profileTarget.target.id, workspaceRoot);
    const markdown = await readFile(profileTarget.markdownPath, "utf8");

    expect(targets.map((target) => target.id)).toEqual(
      expect.arrayContaining([profileTarget.target.id, endpointTarget.target.id])
    );
    expect(loadedProfile.target.targetType).toBe("profile");
    expect(markdown).toContain("type: chrome-target");
    expect(markdown).toContain("mode: profile");
    expect(markdown).toContain("Profile Directory:");
  });

  it("reports structured validation failures for unreachable and unusable targets", async () => {
    const unreachableTarget = {
      id: "attach-unreachable",
      type: "chrome_attach_target",
      name: "Broken Endpoint",
      targetType: "remote_debugging_endpoint",
      endpoint: "http://127.0.0.1:9333",
      createdAt: new Date().toISOString()
    } satisfies ChromeAttachTarget;

    const unreachableResult = await validateChromeAttachTarget({
      target: unreachableTarget,
      sessionFactory: createFailingSessionFactory("chrome_unreachable", "No Chrome on the endpoint")
    });
    expect(unreachableResult).toEqual({
      ok: false,
      code: "chrome_unreachable",
      message: "No Chrome on the endpoint"
    });

    const signedOutResult = await validateChromeAttachTarget({
      target: unreachableTarget,
      sessionFactory: createFailingSessionFactory(
        "notebooklm_sign_in_required",
        "NotebookLM redirected to sign in"
      )
    });
    expect(signedOutResult).toEqual({
      ok: false,
      code: "notebooklm_sign_in_required",
      message: "NotebookLM redirected to sign in"
    });
  });
});

describe("Attached NotebookLM runs", () => {
  it("records attached execution metadata for a successful run", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Reusable Chrome",
      endpoint: "http://127.0.0.1:9222"
    });
    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Attached Notebook",
      topic: "attached-run",
      notebookUrl: "https://notebooklm.google.com/notebook/attached",
      accessMode: "owner",
      attachTargetId: attachTarget.target.id
    });
    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "attached execution",
      notebookBindingId: binding.binding.id
    });

    const adapter = new BrowserAgentNotebookRunnerAdapter({
      attachTarget: attachTarget.target,
      sessionFactory: createSuccessSessionFactory()
    });

    const result = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter
    });

    const runIndex = JSON.parse(await readFile(path.join(plan.runDir, "index.json"), "utf8")) as {
      status: string;
      executionMode?: string;
      attachedChromeTargetId?: string;
    };
    const runMarkdown = await readFile(plan.runMarkdownPath, "utf8");

    expect(result.run.status).toBe("completed");
    expect(runIndex.executionMode).toBe("attached_chrome");
    expect(runIndex.attachedChromeTargetId).toBe(attachTarget.target.id);
    expect(runMarkdown).toContain("Attach Target:");
    expect(runMarkdown).toContain("[[chrome-targets/");
  });

  it("fails before execution when attached preflight cannot use NotebookLM", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Signed Out Chrome",
      endpoint: "http://127.0.0.1:9222"
    });
    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Signed Out Notebook",
      topic: "signed-out",
      notebookUrl: "https://notebooklm.google.com/notebook/signed-out",
      accessMode: "owner",
      attachTargetId: attachTarget.target.id
    });
    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "preflight failure",
      notebookBindingId: binding.binding.id
    });

    const adapter = new BrowserAgentNotebookRunnerAdapter({
      attachTarget: attachTarget.target,
      sessionFactory: createFailingSessionFactory(
        "notebooklm_sign_in_required",
        "NotebookLM redirected to sign in"
      )
    });

    await expect(
      executeQARun({
        cwd: workspaceRoot,
        runId: plan.run.id,
        adapter
      })
    ).rejects.toThrow(/sign in/i);

    const runIndex = JSON.parse(await readFile(path.join(plan.runDir, "index.json"), "utf8")) as {
      status: string;
      failureReason?: string;
    };

    expect(runIndex.status).toBe("failed");
    expect(runIndex.failureReason).toMatch(/sign in/i);
  });

  it("preserves completed exchanges when attached execution fails mid-run", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Flaky Chrome",
      endpoint: "http://127.0.0.1:9222"
    });
    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Flaky Notebook",
      topic: "attached-partial",
      notebookUrl: "https://notebooklm.google.com/notebook/flaky",
      accessMode: "owner",
      attachTargetId: attachTarget.target.id
    });
    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "partial attached execution",
      notebookBindingId: binding.binding.id
    });

    const failureQuestionId = plan.batch.questions[1]?.id;
    const adapter = new BrowserAgentNotebookRunnerAdapter({
      attachTarget: attachTarget.target,
      sessionFactory: createSuccessSessionFactory({
        failQuestionId: failureQuestionId
      })
    });

    const result = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter
    });

    expect(result.run.status).toBe("incomplete");
    expect(result.run.failedQuestionId).toBe(failureQuestionId);
    expect(result.completedExchanges).toHaveLength(1);

    const workspace = await loadWorkspace(workspaceRoot);
    const firstExchangePath = getExchangeNote(workspace, plan.run.id, plan.batch.questions[0]!).absolutePath;
    const failedExchangePath = getExchangeNote(workspace, plan.run.id, plan.batch.questions[1]!).absolutePath;

    await expect(readFile(firstExchangePath, "utf8")).resolves.toContain("Attached answer for");
    await expect(readFile(failedExchangePath, "utf8")).rejects.toThrow();
  });
});

function createFailingSessionFactory(
  code: "chrome_unreachable" | "notebooklm_sign_in_required" | "notebooklm_preflight_failed",
  message: string
): NotebookBrowserSessionFactory {
  return {
    async createSession(): Promise<NotebookBrowserSession> {
      return {
        async preflight() {
          throw new ChromeAttachValidationError(code, message);
        },
        async askQuestion() {
          throw new Error("askQuestion should not run when preflight fails");
        },
        async captureLatestAnswer() {
          throw new Error("captureLatestAnswer should not run when preflight fails");
        },
        async createNotebook() {
          throw new Error("createNotebook should not run when preflight fails");
        },
        async importSource() {
          throw new Error("importSource should not run when preflight fails");
        },
        async close() {}
      };
    }
  };
}

function createSuccessSessionFactory(options: {
  failQuestionId?: string;
} = {}): NotebookBrowserSessionFactory {
  return {
    async createSession(): Promise<NotebookBrowserSession> {
      return {
        async preflight() {},
        async askQuestion(question: PlannedQuestion) {
          if (options.failQuestionId && question.id === options.failQuestionId) {
            throw new Error(`Attached session failed for ${question.id}`);
          }

          return {
            answer: `Attached answer for ${question.prompt}`,
            citations: [
              {
                label: "source-1",
                sourcePath: "vault/sources/source-1.md"
              }
            ]
          };
        },
        async captureLatestAnswer() {
          return {
            answer: "latest attached answer",
            citations: []
          };
        },
        async createNotebook() {
          return {
            notebookUrl: "https://notebooklm.google.com/notebook/created"
          };
        },
        async importSource() {
          return {
            status: "imported" as const
          };
        },
        async close() {}
      };
    }
  };
}
