import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { doctorCommand } from "../src/commands/doctor.js";
import { notebookBindCommand } from "../src/commands/notebook-bind.js";
import { notebookSourceCommand } from "../src/commands/notebook-source.js";
import { planContextCommand } from "../src/commands/plan-context.js";
import { planCommand, resolvePlanInput } from "../src/commands/plan.js";
import { runCommand } from "../src/commands/run.js";
import { statusCommand } from "../src/commands/status.js";
import { topicCommand } from "../src/commands/topic.js";
import {
  buildDoctorReport,
  buildWorkspaceStatusReport,
  formatDoctorReport,
  formatWorkspaceStatusReport
} from "../src/core/operator/workspace-operator.js";
import { DEFAULT_MAX_QUESTIONS } from "../src/core/runs/question-planner.js";
import { bindNotebook } from "../src/core/notebooks/bind-notebook.js";
import { declareNotebookSourceManifest } from "../src/core/notebooks/manage-notebook-source-manifests.js";
import { createManagedNotebook, importIntoManagedNotebook } from "../src/core/notebooks/manage-managed-notebooks.js";
import { FixtureNotebookRunnerAdapter } from "../src/core/notebooklm/fixture-adapter.js";
import { createQuestionPlan } from "../src/core/runs/question-planner.js";
import { executeQARun } from "../src/core/runs/run-qa.js";
import { createTopic } from "../src/core/topics/manage-topics.js";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
import { ingestSource } from "../src/core/ingest/ingest-source.js";
import { loadWorkspace } from "../src/core/workspace/load-workspace.js";
import { getVaultPaths } from "../src/core/vault/paths.js";
import { registerChromeEndpointTarget, registerChromeProfileTarget } from "../src/core/attach/manage-targets.js";
import { getQuestionPlannerSetupMessage } from "../src/core/runs/question-planner.js";
import type { ManagedNotebookBrowserImportInput, NotebookBrowserSession, NotebookBrowserSessionFactory } from "../src/core/notebooklm/browser-agent.js";
import { loadTopic } from "../src/core/topics/manage-topics.js";

describe("operator CLI workflow", () => {
  afterEach(() => {
    process.chdir("/Users/twlee/projects/SourceLoop");
  });

  it("reports empty-workspace status with a first next action", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const report = await buildWorkspaceStatusReport(workspaceRoot);
    const text = formatWorkspaceStatusReport(report);

    expect(report.summary.topicCount).toBe(0);
    expect(report.nextActions[0]).toMatchObject({
      kind: "create_topic"
    });
    expect(text).toContain("No active research setup yet.");
    expect(text).toContain("sourceloop topic create");
  });

  it("summarizes mixed topic readiness and next actions", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topicMissingBinding = await createTopic({
      cwd: workspaceRoot,
      name: "Topic without notebook"
    });

    const topicNeedsPlan = await createTopic({
      cwd: workspaceRoot,
      name: "Topic ready for planning"
    });
    const readyBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Ready Notebook",
      topic: topicNeedsPlan.topic.name,
      topicId: topicNeedsPlan.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/ready",
      accessMode: "owner"
    });
    await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topicNeedsPlan.topic.id,
      notebookBindingId: readyBinding.binding.id,
      kind: "document-set",
      title: "Ready source set"
    });

    const topicIncompleteRun = await createTopic({
      cwd: workspaceRoot,
      name: "Topic with incomplete run"
    });
    const sourcePath = path.join(workspaceRoot, "incomplete-source.md");
    await writeFile(sourcePath, "Source for incomplete run", "utf8");
    await ingestSource({
      cwd: workspaceRoot,
      input: sourcePath,
      topicId: topicIncompleteRun.topic.id
    });
    const incompleteBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Incomplete Notebook",
      topic: topicIncompleteRun.topic.name,
      topicId: topicIncompleteRun.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/incomplete",
      accessMode: "owner"
    });
    const incompletePlan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: topicIncompleteRun.topic.id,
      notebookBindingId: incompleteBinding.binding.id,
      maxQuestions: 1
    });
    const emptyFixturePath = path.join(workspaceRoot, "incomplete-fixture.json");
    await writeFile(emptyFixturePath, JSON.stringify({}, null, 2), "utf8");
    await executeQARun({
      cwd: workspaceRoot,
      runId: incompletePlan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(emptyFixturePath)
    });

    const report = await buildWorkspaceStatusReport(workspaceRoot);
    const text = formatWorkspaceStatusReport(report);

    expect(report.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: topicMissingBinding.topic.id, status: "initialized" }),
        expect.objectContaining({ id: topicNeedsPlan.topic.id, status: "ready_for_planning" }),
        expect.objectContaining({ id: topicIncompleteRun.topic.id, status: "researched" })
      ])
    );
    expect(report.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "bind_notebook", topicId: topicMissingBinding.topic.id }),
        expect.objectContaining({ kind: "plan_questions", topicId: topicNeedsPlan.topic.id }),
        expect.objectContaining({ kind: "resume_run", runId: incompletePlan.run.id })
      ])
    );
    expect(text).toContain("Next Actions");
    expect(text).toContain(incompletePlan.run.id);
  });

  it("recommends launching a managed isolated Chrome target before notebook work when no trusted target exists", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Needs browser launch"
    });

    const statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    const doctorReport = await buildDoctorReport(workspaceRoot);

    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "launch_isolated_browser",
          command: "sourceloop chrome launch"
        })
      ])
    );
    expect(doctorReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "attach",
          severity: "warning",
          message: expect.stringContaining("No SourceLoop-managed isolated Chrome target")
        })
      ])
    );
  });

  it("recommends attach validation when a managed isolated target exists but is not NotebookLM-validated", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    await createTopic({
      cwd: workspaceRoot,
      name: "Needs browser validation"
    });

    await registerChromeProfileTarget({
      cwd: workspaceRoot,
      name: "research-browser",
      profileDirPath: path.join(workspaceRoot, ".sourceloop", "chrome-profiles", "research-browser"),
      ownership: "sourceloop_managed",
      profileIsolation: "isolated",
      notebooklmReadiness: "unknown",
      force: true
    });

    const statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    const doctorReport = await buildDoctorReport(workspaceRoot);

    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "validate_attach",
          command: "sourceloop attach validate attach-research-browser"
        })
      ])
    );
    expect(doctorReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "attach",
          severity: "warning",
          message: expect.stringContaining("has not been validated against NotebookLM yet")
        })
      ])
    );
  });

  it("treats shared attach targets as fallback paths that require user confirmation", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Shared browser fallback"
    });

    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "shared-browser",
      endpoint: "http://127.0.0.1:9222",
      profileIsolation: "shared"
    });

    await bindNotebook({
      cwd: workspaceRoot,
      name: "Shared Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/shared",
      accessMode: "owner",
      attachTargetId: attachTarget.target.id
    });

    const statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    const doctorReport = await buildDoctorReport(workspaceRoot);

    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "launch_isolated_browser",
          message: expect.stringContaining("Ask whether to keep going with the current Chrome"),
          command: expect.stringContaining("keep going with the current Chrome")
        })
      ])
    );
    expect(doctorReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "attach",
          severity: "warning",
          message: expect.stringContaining("Ask whether to keep going with that Chrome")
        })
      ])
    );
  });

  it("diagnoses missing bindings, missing evidence, and incomplete runs", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topicMissingBinding = await createTopic({
      cwd: workspaceRoot,
      name: "Doctor missing binding"
    });

    const topicMissingEvidence = await createTopic({
      cwd: workspaceRoot,
      name: "Doctor missing evidence"
    });
    await bindNotebook({
      cwd: workspaceRoot,
      name: "Evidence Notebook",
      topic: topicMissingEvidence.topic.name,
      topicId: topicMissingEvidence.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/missing-evidence",
      accessMode: "owner"
    });

    const topicIncompleteRun = await createTopic({
      cwd: workspaceRoot,
      name: "Doctor incomplete run"
    });
    const sourcePath = path.join(workspaceRoot, "doctor-run-source.md");
    await writeFile(sourcePath, "Source for doctor run", "utf8");
    await ingestSource({
      cwd: workspaceRoot,
      input: sourcePath,
      topicId: topicIncompleteRun.topic.id
    });
    const runBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Doctor Run Notebook",
      topic: topicIncompleteRun.topic.name,
      topicId: topicIncompleteRun.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/doctor-run",
      accessMode: "owner"
    });
    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: topicIncompleteRun.topic.id,
      notebookBindingId: runBinding.binding.id,
      maxQuestions: 1
    });
    const emptyFixturePath = path.join(workspaceRoot, "doctor-incomplete-fixture.json");
    await writeFile(emptyFixturePath, JSON.stringify({}, null, 2), "utf8");
    await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(emptyFixturePath)
    });

    const report = await buildDoctorReport(workspaceRoot);
    const text = formatDoctorReport(report);

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "topic", topicId: topicMissingBinding.topic.id }),
        expect.objectContaining({ category: "evidence", topicId: topicMissingEvidence.topic.id, severity: "error" }),
        expect.objectContaining({ category: "run", runId: plan.run.id, severity: "warning" })
      ])
    );
    expect(text).toContain("Doctor Findings");
    expect(text).toContain("sourceloop run");
  });

  it("surfaces attach isolation warnings in status and doctor", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Attach safety topic"
    });

    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Shared Chrome",
      endpoint: "http://127.0.0.1:9222",
      profileIsolation: "shared"
    });
    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Shared Attach Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/shared-attach",
      accessMode: "owner",
      attachTargetId: attachTarget.target.id
    });
    await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: binding.binding.id,
      kind: "document-set",
      title: "Shared attach evidence"
    });

    const statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    const doctorReport = await buildDoctorReport(workspaceRoot);
    const statusText = formatWorkspaceStatusReport(statusReport);

    expect(statusReport.summary.attachIsolation).toEqual({
      isolated: 0,
      unknown: 0,
      shared: 1
    });
    expect(statusReport.summary.trustedIsolatedAttachTargetCount).toBe(0);
    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "launch_isolated_browser",
          topicId: topic.topic.id,
          notebookBindingId: binding.binding.id
        })
      ])
    );
    expect(doctorReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "attach",
          topicId: topic.topic.id,
          notebookBindingId: binding.binding.id,
          severity: "warning"
        })
      ])
    );
    expect(statusText).toContain("Attach Targets: 1 (0 trusted isolated, 0 isolated, 0 unknown, 1 shared)");
  });

  it("prefers notebook binding over browser launch once a trusted isolated target exists", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Trusted browser topic"
    });

    await registerChromeProfileTarget({
      cwd: workspaceRoot,
      name: "research-browser",
      profileDirPath: path.join(workspaceRoot, ".sourceloop", "chrome-profiles", "research-browser"),
      ownership: "sourceloop_managed",
      profileIsolation: "isolated",
      notebooklmReadiness: "validated",
      notebooklmValidatedAt: new Date().toISOString(),
      force: true
    });

    const statusReport = await buildWorkspaceStatusReport(workspaceRoot);

    expect(statusReport.summary.trustedIsolatedAttachTargetCount).toBe(1);
    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bind_notebook",
          topicId: topic.topic.id
        })
      ])
    );
    expect(statusReport.nextActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "launch_isolated_browser",
          command: "sourceloop chrome launch"
        })
      ])
    );
  });

  it("treats evidence readiness as binding-specific for status and doctor", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Binding specific evidence topic"
    });

    const readyBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Ready Binding",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/ready-binding",
      accessMode: "owner"
    });
    const missingBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Missing Evidence Binding",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/missing-binding",
      accessMode: "owner"
    });

    await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: readyBinding.binding.id,
      kind: "document-set",
      title: "Only ready binding evidence"
    });

    const statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    const doctorReport = await buildDoctorReport(workspaceRoot);

    expect(statusReport.summary.notebookEvidenceCount).toBe(1);
    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "declare_evidence",
          topicId: topic.topic.id,
          notebookBindingId: missingBinding.binding.id
        })
      ])
    );
    expect(statusReport.nextActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "run_planned",
          notebookBindingId: missingBinding.binding.id
        })
      ])
    );
    expect(doctorReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "evidence",
          topicId: topic.topic.id,
          notebookBindingId: missingBinding.binding.id,
          severity: "error"
        })
      ])
    );
  });

  it("counts repaired managed notebook evidence for a remote-id-compatible binding", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Managed repair evidence topic"
    });

    const legacyBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Legacy Managed Binding",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/repair-remote-id",
      accessMode: "owner"
    });
    const repairedBinding = await bindNotebook({
      cwd: workspaceRoot,
      id: "notebook-repair-remote-id",
      name: "Repaired Managed Binding",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/repair-remote-id",
      accessMode: "owner",
      force: true
    });

    const setupId = "managed-notebook-setup-repair-remote-id";
    await writeFile(
      path.join(workspaceRoot, "vault", "notebook-setups", `${setupId}.json`),
      JSON.stringify(
        {
          id: setupId,
          type: "managed_notebook_setup",
          topicId: topic.topic.id,
          notebookBindingId: legacyBinding.binding.id,
          remoteNotebookId: "repair-remote-id",
          name: "Legacy Managed Binding",
          attachTargetId: "attach-missing",
          createdAt: "2026-03-28T00:00:00.000Z",
          updatedAt: "2026-03-28T00:00:00.000Z"
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(workspaceRoot, "vault", "notebook-imports", "managed-import-repair-remote-id.json"),
      JSON.stringify(
        {
          id: "managed-import-repair-remote-id",
          type: "managed_notebook_import",
          topicId: topic.topic.id,
          notebookBindingId: legacyBinding.binding.id,
          managedNotebookSetupId: setupId,
          originType: "remote_url",
          sourceUri: "https://www.youtube.com/watch?v=eMlx5fFNoYc",
          title: "eMlx5fFNoYc",
          importKind: "youtube_url",
          status: "imported",
          createdAt: "2026-03-28T00:00:00.000Z",
          updatedAt: "2026-03-28T00:00:00.000Z"
        },
        null,
        2
      )
    );

    const statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    const repairedBindingSummary = statusReport.topics.find((candidate) => candidate.id === topic.topic.id);

    expect(repairedBindingSummary).toMatchObject({
      managedNotebookImportCount: 1,
      status: "ready_for_planning"
    });
    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "plan_questions",
          topicId: topic.topic.id
        })
      ])
    );
    expect(statusReport.nextActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "declare_evidence",
          topicId: topic.topic.id,
          notebookBindingId: repairedBinding.binding.id
        })
      ])
    );
  });

  it("excludes orphan notebook manifests from top-level evidence summary", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Orphan manifest topic"
    });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Ephemeral Binding",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/ephemeral-binding",
      accessMode: "owner"
    });

    await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: binding.binding.id,
      kind: "document-set",
      title: "Ephemeral evidence"
    });

    await rm(path.join(workspaceRoot, "vault", "notebooks", `${binding.binding.id}.json`), { force: true });
    await rm(binding.markdownPath, { force: true });

    const statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    const doctorReport = await buildDoctorReport(workspaceRoot);

    expect(statusReport.summary.notebookEvidenceCount).toBe(0);
    expect(doctorReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "binding",
          notebookBindingId: binding.binding.id,
          severity: "warning"
        })
      ])
    );
  });

  it("emits JSON payloads for representative operator commands", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "JSON Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    const topicCreateJson = JSON.parse(
      await captureStdout(() =>
        topicCommand.parseAsync(["create", "--name", "JSON Topic", "--json"], { from: "user" })
      )
    ) as { topic: { id: string } };
    expect(topicCreateJson.topic.id).toBe("topic-json-topic");

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "JSON Notebook",
            "--topic-id",
            "topic-json-topic",
            "--url",
            "https://notebooklm.google.com/notebook/json",
            "--attach-target",
            attachTarget.target.id,
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };
    expect(notebookBindJson.binding.id).toBe("notebook-json-notebook");

    const notebookSourceJson = JSON.parse(
      await captureStdout(() =>
        notebookSourceCommand.parseAsync(
          [
            "declare",
            "--topic-id",
            "topic-json-topic",
            "--notebook",
            notebookBindJson.binding.id,
            "--kind",
            "document-set",
            "--title",
            "JSON Source Set",
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { manifest: { id: string } };
    expect(notebookSourceJson.manifest.id).toContain("notebook-source-");

    const browserAgentModule = await import("../src/core/notebooklm/browser-agent.js");
    const originalCreateSession = browserAgentModule.defaultNotebookBrowserSessionFactory.createSession;
    const originalPlannerCommand = process.env.SOURCELOOP_QUESTION_PLANNER_CMD;
    browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = async () => ({
      async preflight() {},
      async capturePlanningSnapshot() {
        return {
          notebookTitle: "JSON Notebook",
          sourceCount: 1,
          summary: "JSON notebook summary."
        };
      },
      async askQuestion() {
        throw new Error("unused");
      },
      async captureLatestAnswer() {
        throw new Error("unused");
      },
      async createNotebook() {
        throw new Error("unused");
      },
      async importSource() {
        throw new Error("unused");
      },
      async close() {}
    });
    process.env.SOURCELOOP_QUESTION_PLANNER_CMD = buildInlinePlannerCommand(1);

    let planJson: {
      run: { id: string };
      batch: { planningMode?: string; questions: Array<{ id: string }> };
      planningContext?: { notebookTitle?: string; sourceCount?: number; summary?: string; planningMode?: string };
      planningContextJsonPath?: string;
    };
    try {
      planJson = JSON.parse(
        await captureStdout(() =>
          planCommand.parseAsync(["topic-json-topic", "--max-questions", "1", "--json"], { from: "user" })
        )
      ) as {
        run: { id: string };
        batch: { planningMode?: string; questions: Array<{ id: string }> };
        planningContext?: { notebookTitle?: string; sourceCount?: number; summary?: string; planningMode?: string };
        planningContextJsonPath?: string;
      };
    } finally {
      browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = originalCreateSession;
      if (originalPlannerCommand === undefined) {
        delete process.env.SOURCELOOP_QUESTION_PLANNER_CMD;
      } else {
        process.env.SOURCELOOP_QUESTION_PLANNER_CMD = originalPlannerCommand;
      }
    }

    expect(planJson.batch.planningMode).toBe("ai_default");
    expect(planJson.batch.questions).toHaveLength(1);
    expect(planJson.planningContext).toMatchObject({
      notebookTitle: "JSON Notebook",
      sourceCount: 1,
      summary: "JSON notebook summary.",
      planningMode: "ai_default"
    });
    expect(planJson.planningContextJsonPath).toBeDefined();
    expect(path.basename(planJson.planningContextJsonPath!)).toBe("planning-context.json");

    const planningContextJson = JSON.parse(await readFile(planJson.planningContextJsonPath!, "utf8")) as {
      notebookTitle?: string;
      sourceCount?: number;
      summary?: string;
      planningMode?: string;
    };
    expect(planningContextJson).toMatchObject({
      notebookTitle: "JSON Notebook",
      sourceCount: 1,
      summary: "JSON notebook summary.",
      planningMode: "ai_default"
    });

    const fixturePath = path.join(workspaceRoot, "json-run-fixture.json");
    await writeFile(
      fixturePath,
      JSON.stringify(
        {
          [planJson.batch.questions[0]!.id]: {
            answer: "JSON answer",
            citations: [{ label: "1" }]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const runJson = JSON.parse(
      await captureStdout(() =>
        runCommand.parseAsync(
          [planJson.run.id, "--adapter", "fixture", "--fixture-file", fixturePath, "--json"],
          { from: "user" }
        )
      )
    ) as { run: { status: string }; completedExchangeCount: number };
    expect(runJson.run.status).toBe("completed");
    expect(runJson.completedExchangeCount).toBe(1);

    const statusJson = JSON.parse(
      await captureStdout(() => statusCommand.parseAsync(["--json"], { from: "user" }))
    ) as { summary: { topicCount: number }; nextActions: unknown[] };
    expect(statusJson.summary.topicCount).toBe(1);
    expect(Array.isArray(statusJson.nextActions)).toBe(true);

    const doctorJson = JSON.parse(
      await captureStdout(() => doctorCommand.parseAsync(["--json"], { from: "user" }))
    ) as { findings: unknown[] };
    expect(Array.isArray(doctorJson.findings)).toBe(true);
  });

  it("documents agent-session planning guidance in the plan help output", () => {
    const help = planCommand.helpInformation();

    expect(help).toContain("or - to read JSON from stdin");
    expect(getQuestionPlannerSetupMessage()).toContain("sourceloop plan-context ... --json");
    expect(getQuestionPlannerSetupMessage()).toContain("sourceloop plan ... --questions-file - --json");
    expect(getQuestionPlannerSetupMessage()).toContain("SOURCELOOP_QUESTION_PLANNER_CMD");
  });

  it("exports notebook-summary planning context for the active agent session", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Planning Context Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    await captureStdout(() =>
      topicCommand.parseAsync(["create", "--name", "Planning Context Topic", "--json"], { from: "user" })
    );

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "Planning Context Notebook",
            "--topic-id",
            "topic-planning-context-topic",
            "--url",
            "https://notebooklm.google.com/notebook/planning-context",
            "--attach-target",
            attachTarget.target.id,
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };

    await captureStdout(() =>
      notebookSourceCommand.parseAsync(
        [
          "declare",
          "--topic-id",
          "topic-planning-context-topic",
          "--notebook",
          notebookBindJson.binding.id,
          "--kind",
          "document-set",
          "--title",
          "Planning Context Source Set",
          "--json"
        ],
        { from: "user" }
      )
    );

    const browserAgentModule = await import("../src/core/notebooklm/browser-agent.js");
    const originalCreateSession = browserAgentModule.defaultNotebookBrowserSessionFactory.createSession;
    browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = async () => ({
      async preflight() {},
      async capturePlanningSnapshot() {
        return {
          notebookTitle: "Planning Context Notebook",
          sourceCount: 1,
          summary: "Planning context notebook summary."
        };
      },
      async askQuestion() {
        throw new Error("unused");
      },
      async captureLatestAnswer() {
        throw new Error("unused");
      },
      async createNotebook() {
        throw new Error("unused");
      },
      async importSource() {
        throw new Error("unused");
      },
      async close() {}
    });

    try {
      const contextJson = JSON.parse(
        await captureStdout(() =>
          planContextCommand.parseAsync(["topic-planning-context-topic", "--max-questions", "3", "--json"], {
            from: "user"
          })
        )
      ) as {
        planningMode: string;
        planningContext: { notebookTitle?: string; sourceCount?: number; summary?: string; planningMode?: string };
        suggestedPlanArguments: { topicOrId: string; questionsFile: string };
        planningScope?: { maxQuestions?: number };
      };

      expect(contextJson.planningMode).toBe("ai_default");
      expect(contextJson.planningScope?.maxQuestions).toBe(3);
      expect(contextJson.suggestedPlanArguments).toEqual({
        topicOrId: "topic-planning-context-topic",
        questionsFile: "-",
        maxQuestions: 3
      });
      expect(contextJson).not.toHaveProperty("runId");
      expect(contextJson).not.toHaveProperty("run");
      expect(contextJson.planningContext).toMatchObject({
        notebookTitle: "Planning Context Notebook",
        sourceCount: 1,
        summary: "Planning context notebook summary.",
        planningMode: "ai_default"
      });
    } finally {
      browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = originalCreateSession;
    }
  });

  it("keeps the summary-backed plan-context -> plan stdin flow working for queued managed imports", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Queued summary-backed topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Queued Summary Chrome",
      endpoint: "http://127.0.0.1:9222"
    });
    const managedNotebook = await createManagedNotebook({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      name: "Queued Summary Notebook",
      attachTargetId: attachTarget.target.id,
      sessionFactory: createManagedOperatorSessionFactory({
        createdNotebookUrl: "https://notebooklm.google.com/notebook/queued-summary-backed"
      })
    });

    await importIntoManagedNotebook({
      cwd: workspaceRoot,
      notebookBindingId: managedNotebook.binding.id,
      url: "https://youtube.com/watch?v=queued-summary-backed",
      sessionFactory: createManagedOperatorSessionFactory({
        importResults: [{ status: "queued" }]
      })
    });

    const refreshed = await loadTopic(topic.topic.id, workspaceRoot);
    expect(refreshed.topic.status).toBe("collecting_sources");
    expect(refreshed.corpus.managedNotebookImportIds).toHaveLength(0);

    const browserAgentModule = await import("../src/core/notebooklm/browser-agent.js");
    const originalCreateSession = browserAgentModule.defaultNotebookBrowserSessionFactory.createSession;
    browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = async () => ({
      async preflight() {},
      async capturePlanningSnapshot() {
        return {
          notebookTitle: "Queued Summary Notebook",
          sourceCount: 1,
          summary: "NotebookLM summary is visible even though the managed import is still queued."
        };
      },
      async askQuestion() {
        throw new Error("unused");
      },
      async captureLatestAnswer() {
        throw new Error("unused");
      },
      async createNotebook() {
        throw new Error("unused");
      },
      async importSource() {
        throw new Error("unused");
      },
      async close() {}
    });

    const originalPlannerCommand = process.env.SOURCELOOP_QUESTION_PLANNER_CMD;
    process.env.SOURCELOOP_QUESTION_PLANNER_CMD = buildInlinePlannerCommand(5);

    try {
      const contextJson = JSON.parse(
        await captureStdout(() =>
          planContextCommand.parseAsync(["topic-queued-summary-backed-topic", "--max-questions", "3", "--json"], {
            from: "user"
          })
        )
      ) as {
        planningScope?: { maxQuestions?: number };
        planningContext: { notebookTitle?: string; sourceCount?: number; summary?: string; planningMode?: string };
        suggestedPlanArguments: { topicOrId: string; questionsFile: string };
      };

      expect(contextJson.planningScope?.maxQuestions).toBe(3);
      expect(contextJson.planningContext).toMatchObject({
        notebookTitle: "Queued Summary Notebook",
        sourceCount: 1,
        summary: "NotebookLM summary is visible even though the managed import is still queued.",
        planningMode: "ai_default"
      });
      expect(contextJson.suggestedPlanArguments).toEqual({
        topicOrId: "topic-queued-summary-backed-topic",
        questionsFile: "-",
        maxQuestions: 3
      });
      expect(contextJson).not.toHaveProperty("runId");

      const stdinQuestions = JSON.stringify({
        questions: Array.from({ length: 5 }, (_, index) => ({
          objective: `Question ${index + 1} objective`,
          prompt: `Question ${index + 1} prompt`
        }))
      });

      const stdin = new PassThrough();
      const originalStdin = process.stdin;
      Object.defineProperty(process, "stdin", {
        value: stdin,
        configurable: true
      });

      try {
        const planInputPromise = resolvePlanInput(topic.topic.id, {
          questionsFile: "-"
        });
        stdin.end(stdinQuestions);
        const planInput = await planInputPromise;
        const plan = await createQuestionPlan({
          cwd: workspaceRoot,
          ...planInput,
          maxQuestions: contextJson.planningScope?.maxQuestions,
          requireAiPlanner: true
        });

        expect(plan.batch.planningMode).toBe("questions_file_override");
        expect(plan.batch.planningScope?.maxQuestions).toBe(3);
        expect(plan.batch.questions).toHaveLength(3);
        expect(plan.batch.questions[0]).toMatchObject({
          objective: "Question 1 objective",
          prompt: "Question 1 prompt"
        });
      } finally {
        Object.defineProperty(process, "stdin", {
          value: originalStdin,
          configurable: true
        });
      }
    } finally {
      browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = originalCreateSession;
      if (originalPlannerCommand === undefined) {
        delete process.env.SOURCELOOP_QUESTION_PLANNER_CMD;
      } else {
        process.env.SOURCELOOP_QUESTION_PLANNER_CMD = originalPlannerCommand;
      }
    }
  });

  it("defaults plan question count to 10 when max-questions is omitted", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Default Count Chrome",
      endpoint: "http://127.0.0.1:9222"
    });

    await captureStdout(() =>
      topicCommand.parseAsync(["create", "--name", "Default Count Topic", "--json"], { from: "user" })
    );

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "Default Count Notebook",
            "--topic-id",
            "topic-default-count-topic",
            "--url",
            "https://notebooklm.google.com/notebook/default-count",
            "--attach-target",
            attachTarget.target.id,
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };

    await captureStdout(() =>
      notebookSourceCommand.parseAsync(
        [
          "declare",
          "--topic-id",
          "topic-default-count-topic",
          "--notebook",
          notebookBindJson.binding.id,
          "--kind",
          "document-set",
          "--title",
          "Default Count Source Set",
          "--json"
        ],
        { from: "user" }
      )
    );

    const browserAgentModule = await import("../src/core/notebooklm/browser-agent.js");
    const originalCreateSession = browserAgentModule.defaultNotebookBrowserSessionFactory.createSession;
    const originalPlannerCommand = process.env.SOURCELOOP_QUESTION_PLANNER_CMD;
    browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = async () => ({
      async preflight() {},
      async capturePlanningSnapshot() {
        return {
          notebookTitle: "Default Count Notebook",
          sourceCount: 1,
          summary: "Default count notebook summary."
        };
      },
      async askQuestion() {
        throw new Error("unused");
      },
      async captureLatestAnswer() {
        throw new Error("unused");
      },
      async createNotebook() {
        throw new Error("unused");
      },
      async importSource() {
        throw new Error("unused");
      },
      async close() {}
    });
    process.env.SOURCELOOP_QUESTION_PLANNER_CMD = buildInlinePlannerCommand(10);

    try {
      const planJson = JSON.parse(
        await captureStdout(() =>
          planCommand.parseAsync(["topic-default-count-topic", "--json"], { from: "user" })
        )
      ) as { batch: { planningMode?: string; questions: Array<{ id: string }>; planningScope?: { maxQuestions?: number } } };

      expect(planJson.batch.planningMode).toBe("ai_default");
      expect(planJson.batch.questions).toHaveLength(DEFAULT_MAX_QUESTIONS);
      expect(planJson.batch.planningScope?.maxQuestions).toBe(DEFAULT_MAX_QUESTIONS);
    } finally {
      browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = originalCreateSession;
      if (originalPlannerCommand === undefined) {
        delete process.env.SOURCELOOP_QUESTION_PLANNER_CMD;
      } else {
        process.env.SOURCELOOP_QUESTION_PLANNER_CMD = originalPlannerCommand;
      }
    }
  });

  it("loads AI-authored questions from a JSON file during planning", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    await captureStdout(() =>
      topicCommand.parseAsync(["create", "--name", "AI Planned Topic", "--json"], { from: "user" })
    );

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "AI Planned Notebook",
            "--topic-id",
            "topic-ai-planned-topic",
            "--url",
            "https://notebooklm.google.com/notebook/ai-planned-topic",
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };

    await captureStdout(() =>
      notebookSourceCommand.parseAsync(
        [
          "declare",
          "--topic-id",
          "topic-ai-planned-topic",
          "--notebook",
          notebookBindJson.binding.id,
          "--kind",
          "document-set",
          "--title",
          "AI Planned Source Set",
          "--json"
        ],
        { from: "user" }
      )
    );

    const questionsPath = path.join(workspaceRoot, "ai-questions.json");
    await writeFile(
      questionsPath,
      JSON.stringify(
        {
          questions: [
            {
              kind: "core",
              objective: "Frame the space.",
              prompt: "What is the actual problem space behind AI planned topic?"
            },
            {
              kind: "execution",
              objective: "Turn the topic into a field guide.",
              prompt: "What sequence should a team follow to apply AI planned topic in practice?"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const browserAgentModule = await import("../src/core/notebooklm/browser-agent.js");
    const originalCreateSession = browserAgentModule.defaultNotebookBrowserSessionFactory.createSession;
    browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = async () => ({
      async preflight() {},
      async capturePlanningSnapshot() {
        return {
          notebookTitle: "AI Planned Notebook",
          sourceCount: 1,
          summary: "AI planned notebook summary."
        };
      },
      async askQuestion() {
        throw new Error("unused");
      },
      async captureLatestAnswer() {
        throw new Error("unused");
      },
      async createNotebook() {
        throw new Error("unused");
      },
      async importSource() {
        throw new Error("unused");
      },
      async close() {}
    });

    try {
      const planJson = JSON.parse(
        await captureStdout(() =>
          planCommand.parseAsync(["topic-ai-planned-topic", "--questions-file", questionsPath, "--json"], { from: "user" })
        )
      ) as {
        batch: {
          questions: Array<{ kind: string; objective: string; prompt: string }>;
          questionFamilies: string[];
        };
      };

      expect(planJson.batch.questions).toHaveLength(2);
      expect(planJson.batch.questionFamilies).toEqual(["core", "execution"]);
      expect(planJson.batch.questions[0]).toMatchObject({
        kind: "core",
        objective: "Frame the space.",
        prompt: "What is the actual problem space behind AI planned topic?"
      });
      expect(planJson.batch.questions[1]).toMatchObject({
        kind: "execution",
        objective: "Turn the topic into a field guide.",
        prompt: "What sequence should a team follow to apply AI planned topic in practice?"
      });
    } finally {
      browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = originalCreateSession;
    }
  });

  it("fails closed when an AI-authored question file contains an unsupported family", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    await captureStdout(() =>
      topicCommand.parseAsync(["create", "--name", "Invalid Family Topic", "--json"], { from: "user" })
    );

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "Invalid Family Notebook",
            "--topic-id",
            "topic-invalid-family-topic",
            "--url",
            "https://notebooklm.google.com/notebook/invalid-family",
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };

    await captureStdout(() =>
      notebookSourceCommand.parseAsync(
        [
          "declare",
          "--topic-id",
          "topic-invalid-family-topic",
          "--notebook",
          notebookBindJson.binding.id,
          "--kind",
          "document-set",
          "--title",
          "Invalid Family Source Set",
          "--json"
        ],
        { from: "user" }
      )
    );

    const questionsPath = path.join(workspaceRoot, "invalid-family-questions.json");
    await writeFile(
      questionsPath,
      JSON.stringify(
        {
          questions: [
            {
              kind: "synthesis",
              objective: "Invent an unsupported family.",
              prompt: "What unsupported synthesis view matters here?"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    await expect(
      planCommand.parseAsync(["topic-invalid-family-topic", "--questions-file", questionsPath, "--json"], { from: "user" })
    ).rejects.toThrow();

    const workspace = await loadWorkspace(workspaceRoot);
    const vault = getVaultPaths(workspace);
    expect(await readdir(vault.runsDir)).toHaveLength(0);
  });

  it("fails closed when an AI-authored question file is an empty top-level array", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    await captureStdout(() =>
      topicCommand.parseAsync(["create", "--name", "Empty Array Topic", "--json"], { from: "user" })
    );

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "Empty Array Notebook",
            "--topic-id",
            "topic-empty-array-topic",
            "--url",
            "https://notebooklm.google.com/notebook/empty-array",
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };

    await captureStdout(() =>
      notebookSourceCommand.parseAsync(
        [
          "declare",
          "--topic-id",
          "topic-empty-array-topic",
          "--notebook",
          notebookBindJson.binding.id,
          "--kind",
          "document-set",
          "--title",
          "Empty Array Source Set",
          "--json"
        ],
        { from: "user" }
      )
    );

    const questionsPath = path.join(workspaceRoot, "empty-array-questions.json");
    await writeFile(questionsPath, "[]", "utf8");

    await expect(
      planCommand.parseAsync(["topic-empty-array-topic", "--questions-file", questionsPath, "--json"], { from: "user" })
    ).rejects.toThrow(/Invalid questions file/);

    const workspace = await loadWorkspace(workspaceRoot);
    const vault = getVaultPaths(workspace);
    expect(await readdir(vault.runsDir)).toHaveLength(0);
  });

  it("fails closed when an AI-authored question file omits required fields", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    await captureStdout(() =>
      topicCommand.parseAsync(["create", "--name", "Missing Field Topic", "--json"], { from: "user" })
    );

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "Missing Field Notebook",
            "--topic-id",
            "topic-missing-field-topic",
            "--url",
            "https://notebooklm.google.com/notebook/missing-field",
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };

    await captureStdout(() =>
      notebookSourceCommand.parseAsync(
        [
          "declare",
          "--topic-id",
          "topic-missing-field-topic",
          "--notebook",
          notebookBindJson.binding.id,
          "--kind",
          "document-set",
          "--title",
          "Missing Field Source Set",
          "--json"
        ],
        { from: "user" }
      )
    );

    const questionsPath = path.join(workspaceRoot, "missing-field-questions.json");
    await writeFile(
      questionsPath,
      JSON.stringify(
        {
          questions: [
            {
              kind: "core",
              prompt: "What is the real problem space behind missing-field topic?"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    await expect(
      planCommand.parseAsync(["topic-missing-field-topic", "--questions-file", questionsPath, "--json"], { from: "user" })
    ).rejects.toThrow();

    const workspace = await loadWorkspace(workspaceRoot);
    const vault = getVaultPaths(workspace);
    expect(await readdir(vault.runsDir)).toHaveLength(0);
  });

  it("returns a clear validation error for malformed AI-authored question files", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    await captureStdout(() =>
      topicCommand.parseAsync(["create", "--name", "Malformed File Topic", "--json"], { from: "user" })
    );

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "Malformed File Notebook",
            "--topic-id",
            "topic-malformed-file-topic",
            "--url",
            "https://notebooklm.google.com/notebook/malformed-file",
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };

    await captureStdout(() =>
      notebookSourceCommand.parseAsync(
        [
          "declare",
          "--topic-id",
          "topic-malformed-file-topic",
          "--notebook",
          notebookBindJson.binding.id,
          "--kind",
          "document-set",
          "--title",
          "Malformed File Source Set",
          "--json"
        ],
        { from: "user" }
      )
    );

    const questionsPath = path.join(workspaceRoot, "malformed-questions.json");
    await writeFile(questionsPath, "{\"questions\":[", "utf8");

    await expect(
      planCommand.parseAsync(["topic-malformed-file-topic", "--questions-file", questionsPath, "--json"], { from: "user" })
    ).rejects.toThrow(new RegExp(`Invalid questions file ${questionsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it("accepts AI-authored question files without internal family labels", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    await captureStdout(() =>
      topicCommand.parseAsync(["create", "--name", "Scope Empty Topic", "--json"], { from: "user" })
    );

    const notebookBindJson = JSON.parse(
      await captureStdout(() =>
        notebookBindCommand.parseAsync(
          [
            "--name",
            "Scope Empty Notebook",
            "--topic-id",
            "topic-scope-empty-topic",
            "--url",
            "https://notebooklm.google.com/notebook/scope-empty",
            "--json"
          ],
          { from: "user" }
        )
      )
    ) as { binding: { id: string } };

    await captureStdout(() =>
      notebookSourceCommand.parseAsync(
        [
          "declare",
          "--topic-id",
          "topic-scope-empty-topic",
          "--notebook",
          notebookBindJson.binding.id,
          "--kind",
          "document-set",
          "--title",
          "Scope Empty Source Set",
          "--json"
        ],
        { from: "user" }
      )
    );

    const questionsPath = path.join(workspaceRoot, "scope-empty-questions.json");
    await writeFile(
      questionsPath,
      JSON.stringify(
        {
          questions: [
            {
              objective: "Frame the topic.",
              prompt: "What is the core framing behind scope empty topic?"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const browserAgentModule = await import("../src/core/notebooklm/browser-agent.js");
    const originalCreateSession = browserAgentModule.defaultNotebookBrowserSessionFactory.createSession;
    browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = async () => ({
      async preflight() {},
      async capturePlanningSnapshot() {
        return {
          notebookTitle: "Scope Empty Notebook",
          sourceCount: 1,
          summary: "Scope empty notebook summary."
        };
      },
      async askQuestion() {
        throw new Error("unused");
      },
      async captureLatestAnswer() {
        throw new Error("unused");
      },
      async createNotebook() {
        throw new Error("unused");
      },
      async importSource() {
        throw new Error("unused");
      },
      async close() {}
    });

    try {
      const planJson = JSON.parse(
        await captureStdout(() =>
          planCommand.parseAsync(["topic-scope-empty-topic", "--questions-file", questionsPath, "--json"], {
            from: "user"
          })
        )
      ) as { batch: { planningMode?: string; questions: Array<{ kind?: string; objective: string; prompt: string }> } };

      expect(planJson.batch.planningMode).toBe("questions_file_override");
      expect(planJson.batch.questions).toHaveLength(1);
      expect(planJson.batch.questions[0]).toMatchObject({
        objective: "Frame the topic.",
        prompt: "What is the core framing behind scope empty topic?"
      });
      expect(planJson.batch.questions[0]?.kind).toBeUndefined();
    } finally {
      browserAgentModule.defaultNotebookBrowserSessionFactory.createSession = originalCreateSession;
    }
  });

  it("accepts AI-authored question files from stdin when --questions-file - is wired through stdin", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    process.chdir(workspaceRoot);

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Stdin questions topic"
    });
    const notebookBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Stdin questions notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/stdin-questions",
      accessMode: "owner"
    });
    await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: notebookBinding.binding.id,
      kind: "document-set",
      title: "Stdin evidence set"
    });

    const stdinQuestions = JSON.stringify({
      questions: [
        {
          objective: "Frame the topic from the active agent session.",
          prompt: "What is the core framing behind stdin questions topic?"
        }
      ]
    });

    const stdin = new PassThrough();
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", {
      value: stdin,
      configurable: true
    });

    try {
      const planInputPromise = resolvePlanInput(topic.topic.id, {
        questionsFile: "-"
      });
      stdin.end(stdinQuestions);
      const planInput = await planInputPromise;
      const plan = await createQuestionPlan({
        cwd: workspaceRoot,
        ...planInput,
        requireAiPlanner: true
      });

      expect(plan.batch.planningMode).toBe("questions_file_override");
      expect(plan.batch.questions).toHaveLength(1);
      expect(plan.batch.questions[0]).toMatchObject({
        objective: "Frame the topic from the active agent session.",
        prompt: "What is the core framing behind stdin questions topic?"
      });
    } finally {
      Object.defineProperty(process, "stdin", {
        value: originalStdin,
        configurable: true
      });
    }
  });

  it("surfaces managed notebook setup readiness in status and doctor", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Managed operator topic"
    });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Managed Operator Chrome",
      endpoint: "http://127.0.0.1:9222",
      profileIsolation: "isolated"
    });

    const sessionFactory = createManagedOperatorSessionFactory({
      createdNotebookUrl: "https://notebooklm.google.com/notebook/managed-operator",
      importResults: [{ status: "queued" }]
    });

    const managedNotebook = await createManagedNotebook({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      name: "Managed Operator Notebook",
      attachTargetId: attachTarget.target.id,
      sessionFactory
    });

    let statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    let doctorReport = await buildDoctorReport(workspaceRoot);

    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "launch_isolated_browser",
          notebookBindingId: managedNotebook.binding.id
        })
      ])
    );
    expect(doctorReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "evidence",
          notebookBindingId: managedNotebook.binding.id,
          message: expect.stringContaining("first imported source")
        })
      ])
    );

    await importIntoManagedNotebook({
      cwd: workspaceRoot,
      notebookBindingId: managedNotebook.binding.id,
      url: "https://example.com/managed-operator-evidence",
      sessionFactory: createManagedOperatorSessionFactory({
        importResults: [{ status: "imported" }]
      })
    });

    statusReport = await buildWorkspaceStatusReport(workspaceRoot);
    doctorReport = await buildDoctorReport(workspaceRoot);

    expect(statusReport.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "launch_isolated_browser",
          notebookBindingId: managedNotebook.binding.id
        })
      ])
    );
    expect(doctorReport.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "evidence",
          notebookBindingId: managedNotebook.binding.id
        })
      ])
    );
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

function createManagedOperatorSessionFactory(options: {
  createdNotebookUrl?: string;
  importResults?: Array<{ status: "queued" | "imported" | "failed"; failureReason?: string }>;
}): NotebookBrowserSessionFactory {
  let importIndex = 0;

  return {
    async createSession(): Promise<NotebookBrowserSession> {
      return {
        async preflight() {},
        async capturePlanningSnapshot() {
          return {
            notebookTitle: "Operator Managed Notebook",
            sourceCount: 1,
            summary: "Operator managed notebook summary."
          };
        },
        async askQuestion() {
          throw new Error("askQuestion is not used in managed operator workflow tests");
        },
        async captureLatestAnswer() {
          throw new Error("captureLatestAnswer is not used in managed operator workflow tests");
        },
        async createNotebook() {
          return {
            notebookUrl: options.createdNotebookUrl ?? "https://notebooklm.google.com/notebook/operator-managed"
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

function buildInlinePlannerCommand(defaultCount: number): string {
  const source = [
    "let raw='';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data',chunk=>raw+=chunk);",
    "process.stdin.on('end',()=>{",
    "const input=JSON.parse(raw);",
    `const count=Math.max(1,input.maxQuestions??${defaultCount});`,
    "const output={questions:Array.from({length:count},(_,index)=>({",
    "objective:'Objective '+(index+1),",
    "prompt:'Prompt '+(index+1)+' for '+input.context.topic",
    "}))};",
    "process.stdout.write(JSON.stringify(output));",
    "});"
  ].join("");

  return `node -e ${JSON.stringify(source)}`;
}
