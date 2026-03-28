import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { listChromeAttachTargets } from "../attach/manage-targets.js";
import { loadWorkspace, type LoadedWorkspace } from "../workspace/load-workspace.js";
import { getRunPaths, getVaultPaths } from "../vault/paths.js";
import { notebookBindingSchema, type NotebookBinding } from "../../schemas/notebook.js";
import type { ChromeAttachTarget } from "../../schemas/attach.js";
import { managedNotebookImportSchema, managedNotebookSetupSchema, type ManagedNotebookImport, type ManagedNotebookSetup } from "../../schemas/managed-notebook.js";
import { notebookSourceManifestSchema, type NotebookSourceManifest } from "../../schemas/notebook-source.js";
import { runIndexSchema, questionBatchSchema, type QARunIndex, type QuestionBatch } from "../../schemas/run.js";
import { sourceDocumentSchema, type SourceDocument } from "../../schemas/source.js";
import { type ResearchTopic, type TopicStatus } from "../../schemas/topic.js";
import { listTopics } from "../topics/manage-topics.js";

export type OperatorNextAction = {
  kind:
    | "create_topic"
    | "launch_isolated_browser"
    | "validate_attach"
    | "bind_notebook"
    | "declare_evidence"
    | "import_managed_source"
    | "plan_questions"
    | "resume_run"
    | "run_planned"
    | "review_attach_safety";
  message: string;
  command: string;
  topicId?: string;
  runId?: string;
  notebookBindingId?: string;
};

export type TopicStatusSummary = {
  id: string;
  name: string;
  status: TopicStatus;
  notebookBindingCount: number;
  localSourceCount: number;
  notebookEvidenceCount: number;
  managedNotebookImportCount: number;
  runCount: number;
  plannedRunCount: number;
  incompleteRunCount: number;
  completedRunCount: number;
};

export type RunStatusSummary = {
  id: string;
  topic: string;
  topicId?: string;
  notebookBindingId: string;
  status: QARunIndex["status"];
  completedQuestionCount: number;
  totalQuestionCount: number;
  failedQuestionId?: string;
  executionMode?: QARunIndex["executionMode"];
};

export type WorkspaceStatusReport = {
  workspaceRoot: string;
  summary: {
    topicCount: number;
    notebookBindingCount: number;
    localSourceCount: number;
    notebookEvidenceCount: number;
    managedNotebookCount: number;
    managedImportCount: number;
    attachTargetCount: number;
    trustedIsolatedAttachTargetCount: number;
    attachIsolation: {
      isolated: number;
      unknown: number;
      shared: number;
    };
    runCount: number;
    plannedRunCount: number;
    incompleteRunCount: number;
    completedRunCount: number;
  };
  topics: TopicStatusSummary[];
  runs: RunStatusSummary[];
  nextActions: OperatorNextAction[];
};

export type DoctorFinding = {
  severity: "error" | "warning" | "info";
  category: "workspace" | "topic" | "binding" | "evidence" | "run" | "attach";
  message: string;
  suggestedCommand?: string;
  topicId?: string;
  notebookBindingId?: string;
  runId?: string;
};

export type DoctorReport = {
  workspaceRoot: string;
  healthy: boolean;
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
  findings: DoctorFinding[];
};

type WorkspaceArtifacts = {
  workspace: LoadedWorkspace;
  topics: ResearchTopic[];
  notebookBindings: NotebookBinding[];
  sources: SourceDocument[];
  notebookSourceManifests: NotebookSourceManifest[];
  managedNotebookSetups: ManagedNotebookSetup[];
  managedNotebookImports: ManagedNotebookImport[];
  runs: QARunIndex[];
  questionBatches: Map<string, QuestionBatch>;
  attachTargets: Awaited<ReturnType<typeof listChromeAttachTargets>>;
};

type BindingEvidenceSummary = {
  notebookBindingId: string;
  topicId?: string;
  hasManagedNotebook: boolean;
  localSourceCount: number;
  alignedNotebookEvidenceCount: number;
  importedManagedEvidenceCount: number;
  queuedManagedImportCount: number;
  failedManagedImportCount: number;
  hasUsableEvidence: boolean;
};

export async function buildWorkspaceStatusReport(cwd?: string): Promise<WorkspaceStatusReport> {
  const artifacts = await loadWorkspaceArtifacts(cwd);
  const topicSummaries = buildTopicSummaries(artifacts);
  const runSummaries = buildRunSummaries(artifacts);
  const bindingEvidence = buildBindingEvidenceSummaries(artifacts);
  const attachTargetsById = new Map(artifacts.attachTargets.map((target) => [target.id, target] as const));
  const trustedIsolatedAttachTargetCount = Array.from(attachTargetsById.values()).filter(isTrustedManagedNotebooklmReadyAttachTarget).length;
  const nextActions = recommendNextActions(artifacts, topicSummaries, runSummaries, bindingEvidence);

  return {
    workspaceRoot: artifacts.workspace.rootDir,
    summary: {
      topicCount: artifacts.topics.length,
      notebookBindingCount: artifacts.notebookBindings.length,
      localSourceCount: artifacts.sources.length,
      notebookEvidenceCount: artifacts.notebookSourceManifests.filter((manifest) =>
        artifacts.notebookBindings.some((binding) => binding.id === manifest.notebookBindingId)
      ).length,
      managedNotebookCount: artifacts.managedNotebookSetups.length,
      managedImportCount: artifacts.managedNotebookImports.filter((managedImport) =>
        managedImport.status === "imported" &&
        artifacts.notebookBindings.some((binding) => binding.id === managedImport.notebookBindingId)
      ).length,
      attachTargetCount: artifacts.attachTargets.length,
      trustedIsolatedAttachTargetCount,
      attachIsolation: {
        isolated: countAttachTargetsByIsolation(attachTargetsById, "isolated"),
        unknown: countAttachTargetsByIsolation(attachTargetsById, "unknown"),
        shared: countAttachTargetsByIsolation(attachTargetsById, "shared")
      },
      runCount: artifacts.runs.length,
      plannedRunCount: runSummaries.filter((run) => run.status === "planned").length,
      incompleteRunCount: runSummaries.filter((run) => run.status === "incomplete").length,
      completedRunCount: runSummaries.filter((run) => run.status === "completed").length
    },
    topics: topicSummaries,
    runs: runSummaries,
    nextActions
  };
}

export async function buildDoctorReport(cwd?: string): Promise<DoctorReport> {
  const artifacts = await loadWorkspaceArtifacts(cwd);
  const findings: DoctorFinding[] = [];
  const bindingEvidence = buildBindingEvidenceSummaries(artifacts);

  if (artifacts.topics.length === 0) {
    findings.push({
      severity: "info",
      category: "workspace",
      message: "Workspace has no research topics yet.",
      suggestedCommand: 'sourceloop topic create --name "Your topic"'
    });
  }

  const bindingIds = new Set(artifacts.notebookBindings.map((binding) => binding.id));
  const attachTargetIds = new Set(artifacts.attachTargets.map((target) => target.id));
  const attachTargetsById = new Map(artifacts.attachTargets.map((target) => [target.id, target] as const));
  const trustedIsolatedAttachTargets = artifacts.attachTargets.filter(isTrustedManagedNotebooklmReadyAttachTarget);
  const managedIsolatedUnvalidatedTargets = artifacts.attachTargets.filter(isManagedIsolatedAttachTarget).filter((target) => target.notebooklmReadiness !== "validated");

  if (artifacts.topics.length > 0 && trustedIsolatedAttachTargets.length === 0 && managedIsolatedUnvalidatedTargets.length === 0) {
    findings.push({
      severity: "warning",
      category: "attach",
      message: "No SourceLoop-managed isolated Chrome target is available for NotebookLM automation.",
      suggestedCommand: 'sourceloop chrome launch'
    });
  }

  for (const target of managedIsolatedUnvalidatedTargets) {
    findings.push({
      severity: "warning",
      category: "attach",
      message: `Managed isolated Chrome target ${target.id} has not been validated against NotebookLM yet.`,
      suggestedCommand: `sourceloop attach validate ${target.id}`
    });
  }

  for (const topic of artifacts.topics) {
    const topicBindings = artifacts.notebookBindings.filter((binding) => binding.topicId === topic.id);

    if (topicBindings.length === 0) {
      findings.push({
        severity: "warning",
        category: "topic",
        topicId: topic.id,
        message: `Topic ${topic.id} does not have a notebook binding yet.`,
        suggestedCommand: `sourceloop notebook-bind --name "${topic.name}" --topic-id ${topic.id} --url "https://notebooklm.google.com/notebook/..."`
      });
      continue;
    }

    const bindingsMissingEvidence = topicBindings.filter((binding) => {
      const summary = bindingEvidence.get(binding.id);
      return !summary?.hasUsableEvidence;
    });

    for (const binding of bindingsMissingEvidence) {
      const summary = bindingEvidence.get(binding.id);
      const needsFirstSource = summary ? needsFirstManagedSourceImport(summary) : false;
      findings.push({
        severity: summary?.hasManagedNotebook ? "warning" : "error",
        category: "evidence",
        topicId: topic.id,
        notebookBindingId: binding.id,
        message: summary?.hasManagedNotebook
          ? needsFirstSource
            ? `Managed notebook binding ${binding.id} for topic ${topic.id} still needs its first imported source.`
            : `Managed notebook binding ${binding.id} for topic ${topic.id} has no imported evidence yet.`
          : `Notebook binding ${binding.id} for topic ${topic.id} has no aligned local or notebook-backed evidence.`,
        suggestedCommand: summary?.hasManagedNotebook
          ? `sourceloop notebook-import --notebook ${binding.id} --url "https://..."`
          : `sourceloop notebook-source declare --topic-id ${topic.id} --notebook ${binding.id} --kind mixed --title "${topic.name} source set"`
      });

      if ((summary?.queuedManagedImportCount ?? 0) > 0) {
        findings.push({
          severity: "info",
          category: "evidence",
          topicId: topic.id,
          notebookBindingId: binding.id,
          message: `Managed notebook binding ${binding.id} has queued imports that are not yet counted as usable evidence.`
        });
      }

      if ((summary?.failedManagedImportCount ?? 0) > 0) {
        findings.push({
          severity: "warning",
          category: "evidence",
          topicId: topic.id,
          notebookBindingId: binding.id,
          message: `Managed notebook binding ${binding.id} has failed imports that need to be retried.`,
          suggestedCommand: `sourceloop notebook-import --notebook ${binding.id} --url "https://..." --force`
        });
      }
    }
  }

  for (const binding of artifacts.notebookBindings) {
    if (binding.attachTargetId && !attachTargetIds.has(binding.attachTargetId)) {
      findings.push({
        severity: "warning",
        category: "attach",
        notebookBindingId: binding.id,
        ...(binding.topicId ? { topicId: binding.topicId } : {}),
        message: `Notebook binding ${binding.id} references missing attach target ${binding.attachTargetId}.`,
        suggestedCommand: `sourceloop attach endpoint --name ${binding.attachTargetId.replace(/^attach-/, "")} --endpoint http://127.0.0.1:9222`
      });
    }

    if (binding.attachTargetId) {
      const attachTarget = attachTargetsById.get(binding.attachTargetId);
      if (attachTarget && !isTrustedManagedNotebooklmReadyAttachTarget(attachTarget)) {
        findings.push({
          severity: "warning",
          category: "attach",
          notebookBindingId: binding.id,
          ...(binding.topicId ? { topicId: binding.topicId } : {}),
          message:
            attachTarget.profileIsolation === "shared"
              ? `Notebook binding ${binding.id} uses shared Chrome attach target ${attachTarget.id}. SourceLoop recommends launching a managed isolated research browser instead.`
              : attachTarget.profileIsolation === "unknown"
                ? `Notebook binding ${binding.id} uses Chrome attach target ${attachTarget.id} with unknown profile isolation. SourceLoop recommends launching a managed isolated research browser instead.`
                : attachTarget.ownership !== "sourceloop_managed"
                  ? `Notebook binding ${binding.id} uses manually registered isolated Chrome attach target ${attachTarget.id}. SourceLoop still recommends a managed isolated research browser as the preferred setup.`
                  : `Notebook binding ${binding.id} uses managed isolated Chrome attach target ${attachTarget.id}, but it has not been validated against NotebookLM yet.`,
          suggestedCommand: buildAttachSafetyCommand(attachTarget)
        });
      }
    }
  }

  for (const manifest of artifacts.notebookSourceManifests) {
    if (!bindingIds.has(manifest.notebookBindingId)) {
      findings.push({
        severity: "warning",
        category: "binding",
        topicId: manifest.topicId,
        notebookBindingId: manifest.notebookBindingId,
        message: `Notebook source manifest ${manifest.id} points to missing notebook binding ${manifest.notebookBindingId}.`
      });
    }
  }

  for (const managedImport of artifacts.managedNotebookImports) {
    if (!bindingIds.has(managedImport.notebookBindingId)) {
      findings.push({
        severity: "warning",
        category: "binding",
        topicId: managedImport.topicId,
        notebookBindingId: managedImport.notebookBindingId,
        message: `Managed notebook import ${managedImport.id} points to missing notebook binding ${managedImport.notebookBindingId}.`
      });
    }
  }

  for (const run of artifacts.runs) {
    if (run.status === "incomplete") {
      findings.push({
        severity: "warning",
        category: "run",
        runId: run.id,
        ...(run.topicId ? { topicId: run.topicId } : {}),
        notebookBindingId: run.notebookBindingId,
        message: `Run ${run.id} is incomplete and can be resumed from the remaining questions.`,
        suggestedCommand: `sourceloop run ${run.id} --show-browser`
      });
    }

    if (run.status === "planned" && !hasUsableAttachTarget(run.notebookBindingId, artifacts.notebookBindings, attachTargetIds)) {
      findings.push({
        severity: "warning",
        category: "attach",
        runId: run.id,
        ...(run.topicId ? { topicId: run.topicId } : {}),
        notebookBindingId: run.notebookBindingId,
        message: `Run ${run.id} does not have a usable attach target on its notebook binding.`,
        suggestedCommand: `sourceloop run ${run.id} --attach-target <target-id> --show-browser`
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;

  return {
    workspaceRoot: artifacts.workspace.rootDir,
    healthy: errorCount === 0 && warningCount === 0,
    summary: {
      errorCount,
      warningCount,
      infoCount
    },
    findings
  };
}

export function formatWorkspaceStatusReport(report: WorkspaceStatusReport): string {
  if (report.summary.topicCount === 0) {
    const firstAction = report.nextActions[0];
    return [
      `Workspace: ${report.workspaceRoot}`,
      "",
      "No active research setup yet.",
      ...(firstAction ? ["", "Next Action", `- ${firstAction.message}`, `  ${firstAction.command}`] : [])
    ].join("\n");
  }

  const topicLines =
    report.topics.length === 0
      ? ["- none"]
      : report.topics.map(
          (topic) =>
            `- ${topic.id} [${topic.status}] notebooks:${topic.notebookBindingCount} evidence:${topic.localSourceCount + topic.notebookEvidenceCount + topic.managedNotebookImportCount} runs:${topic.runCount}`
        );

  const runLines =
    report.runs.length === 0
      ? ["- none yet"]
      : report.runs
          .filter((run) => run.status === "planned" || run.status === "incomplete" || run.status === "running")
          .map(
            (run) =>
              `- ${run.id} [${run.status}] completed:${run.completedQuestionCount}/${run.totalQuestionCount}${run.failedQuestionId ? ` failed:${run.failedQuestionId}` : ""}`
          );

  const nextActionLines =
    report.nextActions.length === 0
      ? ["- none"]
      : report.nextActions.map((action) => `- ${action.message}\n  ${action.command}`);

  return [
    `Workspace: ${report.workspaceRoot}`,
    "",
    "Summary",
    `- Topics: ${report.summary.topicCount}`,
    `- Notebook Bindings: ${report.summary.notebookBindingCount}`,
    `- Evidence: ${report.summary.localSourceCount + report.summary.notebookEvidenceCount + report.summary.managedImportCount}`,
    `- Attach Targets: ${report.summary.attachTargetCount} (${report.summary.trustedIsolatedAttachTargetCount} trusted isolated, ${report.summary.attachIsolation.isolated} isolated, ${report.summary.attachIsolation.unknown} unknown, ${report.summary.attachIsolation.shared} shared)`,
    `- Runs: ${report.summary.runCount} (${report.summary.incompleteRunCount} incomplete, ${report.summary.completedRunCount} completed)`,
    "",
    "Topics",
    ...topicLines,
    "",
    "Open Runs",
    ...runLines,
    "",
    "Next Actions",
    ...nextActionLines
  ].join("\n");
}

export function formatDoctorReport(report: DoctorReport): string {
  if (report.findings.length === 0) {
    return [`Workspace: ${report.workspaceRoot}`, "", "Doctor found no workflow blockers."].join("\n");
  }

  const findingLines = report.findings.flatMap((finding) => [
    `- [${finding.severity}][${finding.category}] ${finding.message}`,
    ...(finding.suggestedCommand ? [`  ${finding.suggestedCommand}`] : [])
  ]);

  return [
    `Workspace: ${report.workspaceRoot}`,
    "",
    `Doctor Findings: ${report.summary.errorCount} error(s), ${report.summary.warningCount} warning(s), ${report.summary.infoCount} info`,
    ...findingLines
  ].join("\n");
}

async function loadWorkspaceArtifacts(cwd?: string): Promise<WorkspaceArtifacts> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const [
    topics,
    notebookBindings,
    sources,
    notebookSourceManifests,
    managedNotebookSetups,
    managedNotebookImports,
    runs,
    attachTargets
  ] = await Promise.all([
    listTopics(workspace.rootDir),
    readJsonDirectory(vault.notebooksDir, notebookBindingSchema),
    readJsonDirectory(vault.sourcesDir, sourceDocumentSchema),
    readJsonDirectory(vault.notebookSourcesDir, notebookSourceManifestSchema),
    readJsonDirectory(vault.notebookSetupsDir, managedNotebookSetupSchema),
    readJsonDirectory(vault.notebookImportsDir, managedNotebookImportSchema),
    readJsonDirectory(vault.runsDir, runIndexSchema, "index.json"),
    listChromeAttachTargets(workspace.rootDir)
  ]);

  const questionBatches = new Map<string, QuestionBatch>();
  for (const run of runs) {
    const batchPath = getRunPaths(workspace, run.id).questionsJsonPath;
    try {
      const raw = await readFile(batchPath, "utf8");
      questionBatches.set(run.id, questionBatchSchema.parse(JSON.parse(raw)));
    } catch {
      // allow status/doctor to proceed even if a run folder is partially broken
    }
  }

  return {
    workspace,
    topics,
    notebookBindings,
    sources,
    notebookSourceManifests,
    managedNotebookSetups,
    managedNotebookImports,
    runs,
    questionBatches,
    attachTargets
  };
}

function buildTopicSummaries(artifacts: WorkspaceArtifacts): TopicStatusSummary[] {
  const bindingIds = new Set(artifacts.notebookBindings.map((binding) => binding.id));

  return artifacts.topics
    .map((topic) => {
      const topicBindings = artifacts.notebookBindings.filter((binding) => binding.topicId === topic.id);
      const localSourceCount = artifacts.sources.filter((source) => source.topicId === topic.id).length;
      const notebookEvidenceCount = artifacts.notebookSourceManifests.filter(
        (manifest) => manifest.topicId === topic.id && bindingIds.has(manifest.notebookBindingId)
      ).length;
      const managedNotebookImportCount = artifacts.managedNotebookImports.filter(
        (managedImport) =>
          managedImport.topicId === topic.id &&
          managedImport.status === "imported" &&
          topicBindings.some((binding) => isManagedNotebookImportCompatibleWithBinding(managedImport, binding, artifacts.managedNotebookSetups))
      ).length;
      const runs = artifacts.runs.filter((run) => run.topicId === topic.id);

      return {
        id: topic.id,
        name: topic.name,
        status: deriveTopicStatus({
          localSourceCount,
          notebookEvidenceCount,
          managedNotebookImportCount,
          notebookBindingCount: topicBindings.length,
          runs
        }),
        notebookBindingCount: topicBindings.length,
        localSourceCount,
        notebookEvidenceCount,
        managedNotebookImportCount,
        runCount: runs.length,
        plannedRunCount: runs.filter((run) => run.status === "planned").length,
        incompleteRunCount: runs.filter((run) => run.status === "incomplete").length,
        completedRunCount: runs.filter((run) => run.status === "completed").length
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildBindingEvidenceSummaries(artifacts: WorkspaceArtifacts): Map<string, BindingEvidenceSummary> {
  return new Map(
    artifacts.notebookBindings.map((binding) => {
      const localSourceCount = artifacts.sources.filter((source) => source.topicId === binding.topicId).length;
      const alignedNotebookEvidenceCount = artifacts.notebookSourceManifests.filter(
        (manifest) => manifest.topicId === binding.topicId && manifest.notebookBindingId === binding.id
      ).length;
      const managedImports = artifacts.managedNotebookImports.filter(
        (managedImport) =>
          managedImport.topicId === binding.topicId &&
          isManagedNotebookImportCompatibleWithBinding(managedImport, binding, artifacts.managedNotebookSetups)
      );
      const importedManagedEvidenceCount = managedImports.filter((managedImport) => managedImport.status === "imported").length;
      const queuedManagedImportCount = managedImports.filter((managedImport) => managedImport.status === "queued").length;
      const failedManagedImportCount = managedImports.filter((managedImport) => managedImport.status === "failed").length;
      const hasManagedNotebook = artifacts.managedNotebookSetups.some((setup) => isManagedNotebookSetupCompatibleWithBinding(setup, binding));

      return [
        binding.id,
        {
          notebookBindingId: binding.id,
          ...(binding.topicId ? { topicId: binding.topicId } : {}),
          hasManagedNotebook,
          localSourceCount,
          alignedNotebookEvidenceCount,
          importedManagedEvidenceCount,
          queuedManagedImportCount,
          failedManagedImportCount,
          hasUsableEvidence: localSourceCount + alignedNotebookEvidenceCount + importedManagedEvidenceCount > 0
        }
      ] satisfies [string, BindingEvidenceSummary];
    })
  );
}

function isManagedNotebookSetupCompatibleWithBinding(setup: ManagedNotebookSetup, binding: NotebookBinding): boolean {
  if (setup.notebookBindingId === binding.id) {
    return true;
  }

  return Boolean(setup.remoteNotebookId && binding.remoteNotebookId && setup.remoteNotebookId === binding.remoteNotebookId);
}

function isManagedNotebookImportCompatibleWithBinding(
  managedImport: ManagedNotebookImport,
  binding: NotebookBinding,
  setups: ManagedNotebookSetup[]
): boolean {
  if (managedImport.notebookBindingId === binding.id) {
    return true;
  }

  if (!binding.remoteNotebookId) {
    return false;
  }

  const setup = setups.find((candidate) => candidate.id === managedImport.managedNotebookSetupId);
  return Boolean(setup?.remoteNotebookId && setup.remoteNotebookId === binding.remoteNotebookId);
}

function buildRunSummaries(artifacts: WorkspaceArtifacts): RunStatusSummary[] {
  return artifacts.runs
    .map((run) => {
      const batch = artifacts.questionBatches.get(run.id);
      return {
        id: run.id,
        topic: run.topic,
        ...(run.topicId ? { topicId: run.topicId } : {}),
        notebookBindingId: run.notebookBindingId,
        status: run.status,
        completedQuestionCount: run.completedQuestionIds.length,
        totalQuestionCount: batch?.questions.length ?? run.completedQuestionIds.length,
        ...(run.failedQuestionId ? { failedQuestionId: run.failedQuestionId } : {}),
        ...(run.executionMode ? { executionMode: run.executionMode } : {})
      };
    })
    .sort((left, right) => right.id.localeCompare(left.id));
}

function recommendNextActions(
  artifacts: WorkspaceArtifacts,
  topics: TopicStatusSummary[],
  runs: RunStatusSummary[],
  bindingEvidence: Map<string, BindingEvidenceSummary>
): OperatorNextAction[] {
  const actions: OperatorNextAction[] = [];
  const attachTargetsById = new Map(artifacts.attachTargets.map((target) => [target.id, target] as const));
  const hasTrustedIsolatedTarget = artifacts.attachTargets.some(isTrustedManagedNotebooklmReadyAttachTarget);
  const managedUnvalidatedTarget = artifacts.attachTargets.find(
    (target) => isManagedIsolatedAttachTarget(target) && target.notebooklmReadiness !== "validated"
  );

  if (artifacts.topics.length === 0) {
    return [
      {
        kind: "create_topic",
        message: "Create your first research topic.",
        command: 'sourceloop topic create --name "Your topic"'
      }
    ];
  }

  if (!hasTrustedIsolatedTarget && !managedUnvalidatedTarget) {
    actions.push({
      kind: "launch_isolated_browser",
      message: "Launch a managed isolated Chrome target before more NotebookLM work.",
      command: "sourceloop chrome launch"
    });
  }

  if (!hasTrustedIsolatedTarget && managedUnvalidatedTarget) {
    actions.push({
      kind: "validate_attach",
      message: `Validate managed Chrome target ${managedUnvalidatedTarget.id} against NotebookLM before more work.`,
      command: `sourceloop attach validate ${managedUnvalidatedTarget.id}`
    });
  }

  for (const run of runs.filter((candidate) => candidate.status === "incomplete")) {
    actions.push({
      kind: "resume_run",
      runId: run.id,
      ...(run.topicId ? { topicId: run.topicId } : {}),
      notebookBindingId: run.notebookBindingId,
      message: `Resume incomplete run ${run.id}.`,
      command: `sourceloop run ${run.id} --show-browser`
    });
  }

  for (const topic of topics) {
    if (topic.notebookBindingCount === 0) {
      actions.push({
        kind: "bind_notebook",
        topicId: topic.id,
        message: `Bind a NotebookLM notebook for topic ${topic.id}.`,
        command: `sourceloop notebook-bind --name "${topic.name}" --topic-id ${topic.id} --url "https://notebooklm.google.com/notebook/..."`
      });
      continue;
    }

    const riskyBinding = artifacts.notebookBindings.find((candidate) => {
      if (candidate.topicId !== topic.id || !candidate.attachTargetId) {
        return false;
      }
      const attachTarget = attachTargetsById.get(candidate.attachTargetId);
      return Boolean(attachTarget && !isTrustedManagedNotebooklmReadyAttachTarget(attachTarget));
    });

    if (riskyBinding?.attachTargetId) {
      const attachTarget = attachTargetsById.get(riskyBinding.attachTargetId);
      if (attachTarget) {
        actions.push({
          kind: "launch_isolated_browser",
          topicId: topic.id,
          notebookBindingId: riskyBinding.id,
          message:
            attachTarget.profileIsolation === "shared"
              ? `Replace shared Chrome attach target ${attachTarget.id} before continuing NotebookLM work for topic ${topic.id}.`
              : attachTarget.profileIsolation === "unknown"
                ? `Launch a managed isolated Chrome target instead of ${attachTarget.id} before continuing NotebookLM work for topic ${topic.id}.`
                : attachTarget.ownership !== "sourceloop_managed"
                  ? `Replace manual isolated Chrome attach target ${attachTarget.id} with a SourceLoop-managed isolated target before continuing NotebookLM work for topic ${topic.id}.`
                  : `Validate managed isolated Chrome attach target ${attachTarget.id} against NotebookLM before continuing work for topic ${topic.id}.`,
          command: buildAttachSafetyCommand(attachTarget)
        });
        continue;
      }
    }

    const missingEvidenceBinding = artifacts.notebookBindings.find(
      (candidate) => candidate.topicId === topic.id && !bindingEvidence.get(candidate.id)?.hasUsableEvidence
    );

    if (missingEvidenceBinding) {
      const summary = bindingEvidence.get(missingEvidenceBinding.id);
      const needsFirstSource = summary ? needsFirstManagedSourceImport(summary) : false;
      actions.push({
        kind: summary?.hasManagedNotebook ? "import_managed_source" : "declare_evidence",
        topicId: topic.id,
        notebookBindingId: missingEvidenceBinding.id,
        message: summary?.hasManagedNotebook
          ? needsFirstSource
            ? `Import the first source into managed notebook ${missingEvidenceBinding.id}.`
            : `Import sources into managed notebook ${missingEvidenceBinding.id}.`
          : `Declare evidence for topic ${topic.id}.`,
        command: summary?.hasManagedNotebook
          ? `sourceloop notebook-import --notebook ${missingEvidenceBinding.id} --url "https://..."`
          : `sourceloop notebook-source declare --topic-id ${topic.id} --notebook ${missingEvidenceBinding.id} --kind mixed --title "${topic.name} source set"`
      });
      continue;
    }

    if (topic.runCount === 0) {
      const hasUsableBinding = artifacts.notebookBindings.some(
        (binding) => binding.topicId === topic.id && bindingEvidence.get(binding.id)?.hasUsableEvidence
      );
      if (!hasUsableBinding) {
        continue;
      }
      actions.push({
        kind: "plan_questions",
        topicId: topic.id,
        message: `Plan questions for topic ${topic.id}.`,
        command: `sourceloop plan ${topic.id}`
      });
      continue;
    }

    const plannedRun = runs.find((run) => run.topicId === topic.id && run.status === "planned");
    if (plannedRun && bindingEvidence.get(plannedRun.notebookBindingId)?.hasUsableEvidence) {
      actions.push({
        kind: "run_planned",
        topicId: topic.id,
        runId: plannedRun.id,
        notebookBindingId: plannedRun.notebookBindingId,
        message: `Run planned batch ${plannedRun.id}.`,
        command: `sourceloop run ${plannedRun.id} --show-browser`
      });
    }
  }

  return dedupeActions(actions).slice(0, 6);
}

function dedupeActions(actions: OperatorNextAction[]): OperatorNextAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.kind}:${action.topicId ?? ""}:${action.runId ?? ""}:${action.notebookBindingId ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function needsFirstManagedSourceImport(summary: BindingEvidenceSummary): boolean {
  return (
    summary.hasManagedNotebook &&
    summary.importedManagedEvidenceCount === 0 &&
    summary.queuedManagedImportCount === 0 &&
    summary.failedManagedImportCount === 0 &&
    summary.alignedNotebookEvidenceCount === 0
  );
}

function countAttachTargetsByIsolation(
  attachTargetsById: Map<string, ChromeAttachTarget>,
  profileIsolation: ChromeAttachTarget["profileIsolation"]
): number {
  return Array.from(attachTargetsById.values()).filter((target) => target.profileIsolation === profileIsolation).length;
}

function deriveTopicStatus(input: {
  localSourceCount: number;
  notebookEvidenceCount: number;
  managedNotebookImportCount: number;
  notebookBindingCount: number;
  runs: QARunIndex[];
}): TopicStatus {
  if (
    input.runs.some(
      (run) =>
        run.completedQuestionIds.length > 0 ||
        run.status === "completed" ||
        run.status === "incomplete"
    )
  ) {
    return "researched";
  }

  if (input.localSourceCount + input.notebookEvidenceCount + input.managedNotebookImportCount > 0 && input.notebookBindingCount > 0) {
    return "ready_for_planning";
  }
  if (input.localSourceCount + input.notebookEvidenceCount + input.managedNotebookImportCount > 0 || input.notebookBindingCount > 0) {
    return "collecting_sources";
  }
  return "initialized";
}

function hasUsableAttachTarget(
  notebookBindingId: string,
  bindings: NotebookBinding[],
  attachTargetIds: Set<string>
): boolean {
  const binding = bindings.find((candidate) => candidate.id === notebookBindingId);
  if (!binding?.attachTargetId) {
    return false;
  }
  return attachTargetIds.has(binding.attachTargetId);
}

function buildAttachSafetyCommand(target: ChromeAttachTarget): string {
  if (isManagedIsolatedAttachTarget(target) && target.notebooklmReadiness !== "validated") {
    return `sourceloop attach validate ${target.id}`;
  }
  return `sourceloop chrome launch --name "${target.name}" --force`;
}

function isManagedIsolatedAttachTarget(target: ChromeAttachTarget): boolean {
  return target.profileIsolation === "isolated" && target.ownership === "sourceloop_managed";
}

function isTrustedManagedNotebooklmReadyAttachTarget(target: ChromeAttachTarget): boolean {
  return isManagedIsolatedAttachTarget(target) && target.notebooklmReadiness === "validated";
}

async function readJsonDirectory<T>(
  directory: string,
  schema: { parse(value: unknown): T },
  nestedJsonFile?: string
): Promise<T[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const filePaths = entries.flatMap((entry) => {
      if (entry.isDirectory()) {
        return nestedJsonFile ? [path.join(directory, entry.name, nestedJsonFile)] : [];
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        return [path.join(directory, entry.name)];
      }
      return [];
    });
    const raw = await Promise.all(filePaths.map((filePath) => readFile(filePath, "utf8")));
    return raw.map((value) => schema.parse(JSON.parse(value)));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
