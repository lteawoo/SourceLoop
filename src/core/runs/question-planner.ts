import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  questionBatchSchema,
  plannedQuestionDraftSchema,
  questionKindSchema,
  questionPlanningContextPreviewSchema,
  questionPlanningContextSchema,
  runIndexSchema,
  type PlannedQuestionDraft,
  type PlannedQuestion,
  type PlanningMode,
  type PlanningScope,
  type QARunIndex,
  type QuestionBatch,
  type QuestionPlanningContext,
  type QuestionPlanningContextPreview
} from "../../schemas/run.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { slugify } from "../../lib/slugify.js";
import { makeAliases, makeTags, normalizeObsidianText, summarizeQuestionTitle } from "../../lib/obsidian.js";
import { loadChromeAttachTarget } from "../attach/manage-targets.js";
import {
  defaultNotebookBrowserSessionFactory,
  type NotebookBrowserSessionFactory,
  type NotebookPlanningSnapshot
} from "../notebooklm/browser-agent.js";
import { listManagedNotebookImports } from "../notebooks/manage-managed-notebooks.js";
import { listNotebookSourceManifests } from "../notebooks/manage-notebook-source-manifests.js";
import {
  getExchangeNote,
  getNotebookNote,
  getQuestionsNote,
  getRunIndexNote,
  getTopicIndexNote,
  toWikiLink
} from "../vault/notes.js";
import { getRunPaths, getVaultPaths } from "../vault/paths.js";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { loadTopic, refreshTopicArtifacts } from "../topics/manage-topics.js";
import { buildRunIndexMarkdown } from "./render-run-note.js";
import { QUESTION_PLANNER_COMMAND_ENV, type QuestionPlanner, generateQuestionsFromPlanningContext } from "./ai-question-planner.js";
import { loadNotebookBinding } from "./load-artifacts.js";
import { notebookBindingSchema } from "../../schemas/notebook.js";

export type CreateQuestionPlanInput = {
  topic?: string;
  topicId?: string;
  notebookBindingId?: string;
  objective?: string;
  maxQuestions?: number;
  families?: string[];
  questions?: PlannedQuestionDraft[];
  planningSnapshot?: NotebookPlanningSnapshot;
  questionPlanner?: QuestionPlanner;
  sessionFactory?: NotebookBrowserSessionFactory;
  plannerEnv?: NodeJS.ProcessEnv;
  plannerShell?: string;
  requireAiPlanner?: boolean;
  cwd?: string;
};

export type CreateQuestionPlanResult = {
  run: QARunIndex;
  batch: QuestionBatch;
  planningContext?: QuestionPlanningContext;
  runDir: string;
  runMarkdownPath: string;
  questionsMarkdownPath: string;
  planningContextJsonPath?: string;
};

export type CreateQuestionPlanningContextInput = {
  topic?: string;
  topicId?: string;
  notebookBindingId?: string;
  objective?: string;
  maxQuestions?: number;
  families?: string[];
  planningSnapshot?: NotebookPlanningSnapshot;
  sessionFactory?: NotebookBrowserSessionFactory;
  cwd?: string;
};

export type QuestionPlanningContextArtifact = {
  topic: string;
  topicId?: string;
  notebookBindingId: string;
  objective: string;
  intendedOutput?: string;
  planningScope?: PlanningScope;
  planningMode: PlanningMode;
  planningContext: QuestionPlanningContextPreview;
  planningContextPreview: QuestionPlanningContextPreview;
  suggestedPlanArguments: {
    topicOrId: string;
    questionsFile: "-";
    maxQuestions: number;
  };
};

export const DEFAULT_MAX_QUESTIONS = 10;

export async function createQuestionPlan(
  input: CreateQuestionPlanInput
): Promise<CreateQuestionPlanResult> {
  const core = await resolveQuestionPlanningCore(input);
  const planningScope = core.planningScope;
  let planningMode: PlanningMode | undefined;
  let planningContext: QuestionPlanningContext | undefined;
  let questions: PlannedQuestion[];

  const shouldFallbackToLegacyPlanner =
    input.questions === undefined &&
    !input.requireAiPlanner &&
    !hasAiPlannerAvailable(input) &&
    !input.planningSnapshot;

  if (input.questions !== undefined) {
    planningMode = "questions_file_override";
    planningContext = await buildPlanningContext(
      {
        runId: core.runId,
        binding: core.binding,
        topicName: core.topicName,
        ...(core.topicRecord?.topic.id ? { topicId: core.topicRecord.topic.id } : {}),
        objective: core.objective,
        ...(core.intendedOutput ? { intendedOutput: core.intendedOutput } : {}),
        planningMode,
        ...(input.planningSnapshot ? { planningSnapshot: input.planningSnapshot } : {}),
        ...(input.sessionFactory ? { sessionFactory: input.sessionFactory } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {})
      },
      core.createdAt
    );
    if (core.topicRecord) {
      await preflightTopicPlanningContext(core.topicRecord.corpus, core.binding, input.cwd, {
        ...(planningContext.sourceCount !== undefined ? { planningSourceCount: planningContext.sourceCount } : {}),
        ...(planningContext.summary ? { planningSummary: planningContext.summary } : {})
      });
    }
    questions = buildProvidedQuestions(input.questions, core.planningScope);
  } else if (shouldFallbackToLegacyPlanner) {
    if (core.topicRecord) {
      await preflightTopicPlanningContext(core.topicRecord.corpus, core.binding, input.cwd);
    }
    questions = buildLegacyPlannedQuestions(core.topicName, core.objective, core.intendedOutput, core.planningScope);
  } else {
    planningMode = "ai_default";
    planningContext = await buildPlanningContext(
      {
        runId: core.runId,
        binding: core.binding,
        topicName: core.topicName,
        ...(core.topicRecord?.topic.id ? { topicId: core.topicRecord.topic.id } : {}),
        objective: core.objective,
        ...(core.intendedOutput ? { intendedOutput: core.intendedOutput } : {}),
        planningMode,
        ...(input.planningSnapshot ? { planningSnapshot: input.planningSnapshot } : {}),
        ...(input.sessionFactory ? { sessionFactory: input.sessionFactory } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {})
      },
      core.createdAt
    );
    if (core.topicRecord) {
      await preflightTopicPlanningContext(core.topicRecord.corpus, core.binding, input.cwd, {
        ...(planningContext.sourceCount !== undefined ? { planningSourceCount: planningContext.sourceCount } : {}),
        ...(planningContext.summary ? { planningSummary: planningContext.summary } : {})
      });
    }
    questions = buildProvidedQuestions(
      await generateQuestionsFromPlanningContext(
        {
          context: planningContext,
          ...(planningScope?.maxQuestions !== undefined ? { maxQuestions: planningScope.maxQuestions } : {})
        },
        {
          ...(input.questionPlanner ? { planner: input.questionPlanner } : {}),
          ...(input.plannerEnv ? { env: input.plannerEnv } : {}),
          ...(input.plannerShell ? { shell: input.plannerShell } : {})
        }
      ),
      planningScope
    );
  }
  const questionFamilies = [...new Set(questions.flatMap((question) => (question.kind ? [question.kind] : [])))];

  const batch = questionBatchSchema.parse({
    id: `batch-${core.runId}`,
    type: "question_batch",
    topic: core.topicName,
    topicId: core.topicRecord?.topic.id,
    notebookBindingId: core.notebookBindingId,
    objective: core.objective,
    intendedOutput: core.intendedOutput,
    ...(planningMode ? { planningMode } : {}),
    questionFamilies,
    ...(core.planningScope ? { planningScope: core.planningScope } : {}),
    createdAt: core.createdAt,
    questions
  });

  const run = runIndexSchema.parse({
    id: core.runId,
    type: "qa_run",
    topic: core.topicName,
    topicId: core.topicRecord?.topic.id,
    notebookBindingId: core.notebookBindingId,
    questionBatchId: batch.id,
    ...(planningMode ? { planningMode } : {}),
    status: "planned",
    ...(core.planningScope ? { planningScope: core.planningScope } : {}),
    createdAt: core.createdAt,
    updatedAt: core.createdAt,
    completedQuestionIds: [],
    outputArtifacts: []
  });

  const runPaths = getRunPaths(core.workspace, run.id);
  const runNote = getRunIndexNote(core.workspace, run);
  const questionsNote = getQuestionsNote(core.workspace, batch);
  const attachTarget = core.binding.attachTargetId
    ? (await loadChromeAttachTarget(core.binding.attachTargetId, input.cwd).catch(() => undefined))?.target
    : undefined;
  await mkdir(runPaths.exchangesDir, { recursive: true });
  await mkdir(runPaths.outputsDir, { recursive: true });

  await writeJsonFile(runPaths.indexJsonPath, run);
  await writeJsonFile(runPaths.questionsJsonPath, batch);
  if (planningContext) {
    await writeJsonFile(runPaths.planningContextJsonPath, planningContext);
  }
  await writeFile(
    runNote.absolutePath,
    buildRunIndexMarkdown({
      workspace: core.workspace,
      run,
      batch,
      binding: core.binding,
      ...(attachTarget ? { attachTarget } : {})
    }),
    "utf8"
  );
  await writeFile(questionsNote.absolutePath, buildQuestionsMarkdown(core.workspace, batch, core.binding), "utf8");
  if (core.topicRecord?.topic.id) {
    await refreshTopicArtifacts(core.topicRecord.topic.id, input.cwd);
  }

  return {
    run,
    batch,
    ...(planningContext ? { planningContext } : {}),
    runDir: runPaths.runDir,
    runMarkdownPath: runNote.absolutePath,
    questionsMarkdownPath: questionsNote.absolutePath,
    ...(planningContext ? { planningContextJsonPath: runPaths.planningContextJsonPath } : {})
  };
}

export async function createQuestionPlanningContext(
  input: CreateQuestionPlanningContextInput
): Promise<QuestionPlanningContextArtifact> {
  const core = await resolveQuestionPlanningCore(input);
  const planningMode: PlanningMode = "ai_default";
  const planningContextPreview = await buildQuestionPlanningContextPreview(
    {
      binding: core.binding,
      topicName: core.topicName,
      ...(core.topicRecord?.topic.id ? { topicId: core.topicRecord.topic.id } : {}),
      objective: core.objective,
      ...(core.intendedOutput ? { intendedOutput: core.intendedOutput } : {}),
      planningMode,
      ...(core.planningScope ? { planningScope: core.planningScope } : {}),
      ...(input.planningSnapshot ? { planningSnapshot: input.planningSnapshot } : {}),
      ...(input.sessionFactory ? { sessionFactory: input.sessionFactory } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {})
    },
    core.createdAt
  );

  if (core.topicRecord) {
    await preflightTopicPlanningContext(core.topicRecord.corpus, core.binding, input.cwd, {
      ...(planningContextPreview.sourceCount !== undefined ? { planningSourceCount: planningContextPreview.sourceCount } : {}),
      ...(planningContextPreview.summary ? { planningSummary: planningContextPreview.summary } : {})
    });
  }

  return {
    topic: core.topicName,
    ...(core.topicRecord?.topic.id ? { topicId: core.topicRecord.topic.id } : {}),
    notebookBindingId: core.notebookBindingId,
    objective: core.objective,
    ...(core.intendedOutput ? { intendedOutput: core.intendedOutput } : {}),
    ...(core.planningScope ? { planningScope: core.planningScope } : {}),
    planningMode,
    planningContext: planningContextPreview,
    planningContextPreview,
    suggestedPlanArguments: {
      topicOrId: core.topicRecord?.topic.id ?? input.topic ?? core.topicName,
      questionsFile: "-",
      maxQuestions: core.planningScope?.maxQuestions ?? DEFAULT_MAX_QUESTIONS
    }
  };
}

function hasAiPlannerAvailable(input: CreateQuestionPlanInput): boolean {
  if (input.questionPlanner) {
    return true;
  }

  const env = input.plannerEnv ?? process.env;
  return Boolean(env[QUESTION_PLANNER_COMMAND_ENV]?.trim());
}

async function buildPlanningContext(
  input: {
    runId: string;
    binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"];
    topicName: string;
    topicId?: string;
    objective: string;
    intendedOutput?: string;
    planningMode: PlanningMode;
    planningSnapshot?: NotebookPlanningSnapshot;
    sessionFactory?: NotebookBrowserSessionFactory;
    cwd?: string;
  },
  createdAt: string
): Promise<QuestionPlanningContext> {
  const snapshot =
    input.planningSnapshot ??
    (input.planningMode === "questions_file_override"
      ? await captureNotebookPlanningSnapshot(input.binding, input.sessionFactory, input.cwd).catch(() => undefined)
      : await captureNotebookPlanningSnapshot(input.binding, input.sessionFactory, input.cwd));

  if (input.planningMode !== "questions_file_override" && !snapshot) {
    throw new Error(
      "NotebookLM planning context is not ready yet. Wait for the notebook summary to appear, then rerun planning."
    );
  }

  return questionPlanningContextSchema.parse({
    id: `planning-context-${input.runId}`,
    type: "question_planning_context",
    runId: input.runId,
    topic: input.topicName,
    topicId: input.topicId,
    notebookBindingId: input.binding.id,
    notebookUrl: input.binding.notebookUrl,
    notebookTitle: snapshot?.notebookTitle,
    sourceCount: snapshot?.sourceCount,
    summary: snapshot?.summary,
    objective: input.objective,
    intendedOutput: input.intendedOutput,
    planningMode: input.planningMode,
    createdAt
  });
}

async function buildQuestionPlanningContextPreview(
  input: {
    binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"];
    topicName: string;
    topicId?: string;
    objective: string;
    intendedOutput?: string;
    planningMode: PlanningMode;
    planningScope?: PlanningScope;
    planningSnapshot?: NotebookPlanningSnapshot;
    sessionFactory?: NotebookBrowserSessionFactory;
    cwd?: string;
  },
  createdAt: string
): Promise<QuestionPlanningContextPreview> {
  const snapshot =
    input.planningSnapshot ??
    (await captureNotebookPlanningSnapshot(input.binding, input.sessionFactory, input.cwd));

  return questionPlanningContextPreviewSchema.parse({
    type: "question_planning_context_preview",
    topic: input.topicName,
    ...(input.topicId ? { topicId: input.topicId } : {}),
    notebookBindingId: input.binding.id,
    notebookUrl: input.binding.notebookUrl,
    notebookTitle: snapshot.notebookTitle,
    sourceCount: snapshot.sourceCount,
    summary: snapshot.summary,
    objective: input.objective,
    ...(input.intendedOutput ? { intendedOutput: input.intendedOutput } : {}),
    planningMode: input.planningMode,
    ...(input.planningScope ? { planningScope: input.planningScope } : {}),
    createdAt
  });
}

async function captureNotebookPlanningSnapshot(
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"],
  sessionFactory: NotebookBrowserSessionFactory | undefined,
  cwd?: string
): Promise<NotebookPlanningSnapshot> {
  if (!binding.attachTargetId) {
    throw new Error(
      `Notebook ${binding.id} does not have an attached Chrome target. Configure an attach target or provide --questions-file.`
    );
  }

  const { target } = await loadChromeAttachTarget(binding.attachTargetId, cwd);
  const resolvedSessionFactory = sessionFactory ?? defaultNotebookBrowserSessionFactory;
  const session = await resolvedSessionFactory.createSession({
    target,
    reuseExistingNotebookPage: true
  });

  try {
    await session.preflight(binding.notebookUrl);
    return await session.capturePlanningSnapshot(binding.notebookUrl);
  } finally {
    await session.close();
  }
}

async function preflightTopicPlanningContext(
  corpus: Awaited<ReturnType<typeof loadTopic>>["corpus"],
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"],
  cwd?: string,
  options?: {
    planningSourceCount?: number;
    planningSummary?: string;
  }
) {
  if (binding.topicId && binding.topicId !== corpus.topicId) {
    throw new Error(
      `Notebook binding ${binding.id} belongs to ${binding.topicId}, not topic ${corpus.topicId}.`
    );
  }
  if (!corpus.notebookBindingIds.includes(binding.id)) {
    throw new Error(`Topic ${corpus.topicId} corpus does not include notebook binding ${binding.id}. Refresh or re-bind the notebook.`);
  }

  const notebookSourceManifests = await listNotebookSourceManifests(cwd);
  const matchingNotebookEvidenceCount = notebookSourceManifests.filter(
    (manifest) =>
      corpus.notebookSourceManifestIds.includes(manifest.id) &&
      manifest.notebookBindingId === binding.id
  ).length;
  const managedNotebookImports = await listManagedNotebookImports(cwd);
  const matchingManagedEvidenceCount = managedNotebookImports.filter(
    (managedImport) =>
      corpus.managedNotebookImportIds.includes(managedImport.id) &&
      managedImport.notebookBindingId === binding.id &&
      managedImport.status === "imported"
  ).length;
  const evidenceCount = corpus.sourceIds.length + matchingNotebookEvidenceCount + matchingManagedEvidenceCount;
  const hasNotebookSummaryEvidence =
    (options?.planningSourceCount ?? 0) > 0 && Boolean(options?.planningSummary?.trim());
  if (evidenceCount === 0 && hasNotebookSummaryEvidence) {
    return;
  }

  if (evidenceCount === 0) {
    throw new Error(
      `Topic ${corpus.topicId} has no declared evidence aligned to notebook binding ${binding.id}. Ingest topic-backed material, declare a notebook-source manifest, or import managed sources for this notebook before planning NotebookLM questions.`
    );
  }
}

function buildRunId(topic: string, timestamp: Date): string {
  const time = timestamp.toISOString().replace(/[:.]/g, "-");
  return `run-${slugify(topic)}-${time}`;
}

function buildProvidedQuestions(
  inputQuestions: PlannedQuestionDraft[],
  planningScope?: PlanningScope
): PlannedQuestion[] {
  const normalizedQuestions = inputQuestions.map((question) => plannedQuestionDraftSchema.parse(question));
  if (normalizedQuestions.length === 0) {
    throw new Error("Question planning requires at least one AI-authored question draft.");
  }

  const filteredQuestions = normalizedQuestions.filter((question) => {
    if (!planningScope?.selectedFamilies?.length) {
      return true;
    }

    if (!question.kind) {
      return false;
    }

    return planningScope.selectedFamilies.includes(question.kind);
  });
  const scopedQuestions =
    planningScope?.maxQuestions !== undefined
      ? filteredQuestions.slice(0, planningScope.maxQuestions)
      : filteredQuestions;

  if (scopedQuestions.length === 0) {
    throw new Error("Question planning produced no usable questions after applying the selected planning scope.");
  }

  return scopedQuestions.map((question, index) => ({
    id: `q${String(index + 1).padStart(2, "0")}-${randomUUID().replace(/-/g, "").slice(0, 6)}`,
    ...(question.kind ? { kind: questionKindSchema.parse(question.kind) } : {}),
    prompt: question.prompt,
    objective: question.objective,
    order: index
  }));
}

function buildLegacyPlannedQuestions(
  topic: string,
  objective: string,
  intendedOutput?: string,
  planningScope?: PlanningScope
): PlannedQuestion[] {
  const prompts = [
    {
      kind: "core",
      objective: `Identify the core concepts and framing for ${topic}.`,
      prompt: `What are the core concepts, scope boundaries, and important definitions for ${topic}?`
    },
    {
      kind: "structure",
      objective: `Map the structure and major segments inside ${topic}.`,
      prompt: `How is ${topic} structured into major segments, layers, or categories, and how do they relate to each other?`
    },
    {
      kind: "deep_dive",
      objective: `Find the major bottlenecks or constraints for ${topic}.`,
      prompt: `What are the most important bottlenecks, constraints, or failure modes within ${topic}?`
    },
    {
      kind: "deep_dive",
      objective: `Identify structural risks or dependency constraints for ${topic}.`,
      prompt: `What dependencies, hidden assumptions, or structural risks most affect outcomes in ${topic}?`
    },
    {
      kind: "comparison",
      objective: `Compare the major alternatives and trade-offs around ${topic}.`,
      prompt: `What are the key alternatives, trade-offs, or contrasting approaches related to ${topic}?`
    },
    {
      kind: "comparison",
      objective: `Distinguish important sub-types or competing schools within ${topic}.`,
      prompt: `Which competing approaches or schools of thought matter most within ${topic}, and when does each approach win or fail?`
    },
    {
      kind: "execution",
      objective: `Extract practical next steps for ${topic}.`,
      prompt: `What practical steps, checklists, or execution guidance should someone follow for ${topic}${intendedOutput ? ` if the goal is ${intendedOutput}` : ""}?`
    },
    {
      kind: "execution",
      objective: `Connect the research topic to the intended human output.`,
      prompt: `If someone wanted to turn ${topic} into ${intendedOutput ?? "a practical output"}, what structure or sequence would make the explanation most useful?`
    },
    {
      kind: "evidence_gap",
      objective: `Expose missing evidence and counterexamples around ${topic}.`,
      prompt: `What evidence is missing, contested, or likely to be overstated in common narratives about ${topic}?`
    },
    {
      kind: "evidence_gap",
      objective: `Identify what would need verification before presenting ${topic} confidently.`,
      prompt: `Which claims about ${topic} would require further verification, counterexamples, or direct source checking before reuse?`
    }
  ] as const;

  const filteredPrompts = prompts.filter((entry) =>
    planningScope?.selectedFamilies?.length ? planningScope.selectedFamilies.includes(entry.kind) : true
  );
  const scopedPrompts =
    planningScope?.maxQuestions !== undefined
      ? filteredPrompts.slice(0, planningScope.maxQuestions)
      : filteredPrompts;

  return scopedPrompts.map((entry, index) => ({
    id: `q${String(index + 1).padStart(2, "0")}-${randomUUID().replace(/-/g, "").slice(0, 6)}`,
    kind: entry.kind,
    prompt: entry.prompt,
    objective: index === 0 ? objective : entry.objective,
    order: index
  }));
}

function normalizePlanningScope(maxQuestions?: number, families?: string[]): PlanningScope | undefined {
  const selectedFamilies = families?.map((family) => questionKindSchema.parse(family));
  const normalizedMaxQuestions = maxQuestions ?? DEFAULT_MAX_QUESTIONS;

  const scope = {
    maxQuestions: normalizedMaxQuestions,
    ...(selectedFamilies && selectedFamilies.length > 0 ? { selectedFamilies } : {})
  };
  return scope;
}

async function resolveQuestionPlanningCore(
  input: CreateQuestionPlanInput | CreateQuestionPlanningContextInput
): Promise<{
  workspace: Awaited<ReturnType<typeof loadWorkspace>>;
  topicRecord?: Awaited<ReturnType<typeof loadTopic>>;
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"];
  notebookBindingId: string;
  topicName: string;
  objective: string;
  intendedOutput?: string;
  planningScope?: PlanningScope;
  runId: string;
  createdAt: string;
}> {
  const workspace = await loadWorkspace(input.cwd);
  const topicRecord = input.topicId ? await loadTopic(input.topicId, input.cwd) : undefined;
  const notebookBindingId =
    input.notebookBindingId ??
    (input.topicId ? await resolveNotebookBindingIdForTopic(workspace.rootDir, input.topicId) : undefined);

  if (!notebookBindingId) {
    throw new Error("Question planning requires a notebook binding. For the preferred flow, create a topic-bound notebook and plan by topic id.");
  }

  const { binding } = await loadNotebookBinding(notebookBindingId, input.cwd);
  const timestamp = new Date();
  const createdAt = timestamp.toISOString();
  const topicName = normalizeObsidianText(topicRecord?.topic.name ?? input.topic ?? binding.topic);
  const objective =
    input.objective ??
    topicRecord?.topic.goal ??
    `Research ${topicName} through a planned NotebookLM Q&A run.`;
  const intendedOutput = topicRecord?.topic.intendedOutput;
  const planningScope = normalizePlanningScope(input.maxQuestions, input.families);
  const runId = buildRunId(topicName, timestamp);

  return {
    workspace,
    ...(topicRecord ? { topicRecord } : {}),
    binding,
    notebookBindingId,
    topicName,
    objective,
    ...(intendedOutput ? { intendedOutput } : {}),
    ...(planningScope ? { planningScope } : {}),
    runId,
    createdAt
  };
}

function buildQuestionsMarkdown(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  batch: QuestionBatch,
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"]
): string {
  const runId = batch.id.replace(/^batch-/, "");
  const sections = batch.questions.flatMap((question) => {
    const answerNote = getExchangeNote(workspace, runId, question);
    return [
      `## ${summarizeQuestionTitle(question.prompt, question.id)}`,
      "",
      `- Objective: ${question.objective}`,
      `- Answer Note: ${toWikiLink(workspace, answerNote.absolutePath, answerNote.title)}`,
      "",
      question.prompt,
      ""
    ];
  });
  const topicTitle = normalizeObsidianText(batch.topic, batch.id);

  return toFrontmatterMarkdown(
    {
      type: "questions",
      title: `${topicTitle} Questions`,
      aliases: makeAliases(batch.id),
      tags: makeTags("sourceloop", "research", "questions", batch.planningMode),
      topic: topicTitle,
      objective: batch.objective,
      ...(batch.intendedOutput ? { output: batch.intendedOutput } : {}),
      ...(batch.planningMode ? { planning_mode: batch.planningMode } : {}),
      ...(batch.planningScope?.maxQuestions ? { max_questions: String(batch.planningScope.maxQuestions) } : {}),
      created: batch.createdAt,
      updated: batch.createdAt
    },
    [
      `# ${topicTitle} Questions`,
      "",
      `## Context`,
      `- Topic: ${
        batch.topicId
          ? toWikiLink(
              workspace,
              getTopicIndexNote(workspace, {
                id: batch.topicId,
                type: "research_topic",
                name: batch.topic,
                status: "initialized",
                createdAt: batch.createdAt,
                updatedAt: batch.createdAt
              }).absolutePath,
              topicTitle
            )
          : topicTitle
      }`,
      `- Notebook: ${toWikiLink(workspace, getNotebookNote(workspace, binding).absolutePath, getNotebookNote(workspace, binding).title)}`,
      `- Planning Scope: ${describePlanningScope(batch)}`,
      "",
      ...sections
    ].join("\n")
  );
}

function describePlanningScope(batch: QuestionBatch): string {
  const parts: string[] = [];
  parts.push(
    batch.planningMode === "questions_file_override"
      ? "manual question override"
      : batch.planningMode === "ai_default"
        ? "AI-generated from notebook summary"
        : "legacy template planner"
  );
  if (batch.planningScope?.maxQuestions !== undefined) {
    parts.push(`max ${batch.planningScope.maxQuestions} questions`);
  }

  return parts.join(" | ");
}

async function resolveNotebookBindingIdForTopic(rootDir: string, topicId: string): Promise<string> {
  const workspace = await loadWorkspace(rootDir);
  const vault = getVaultPaths(workspace);
  const entries = await readdir(vault.notebooksDir);
  const notebookFiles = entries.filter((entry) => entry.endsWith(".json"));
  const notebooks = await Promise.all(
    notebookFiles.map(async (entry) => notebookBindingSchema.parse(JSON.parse(await readFile(path.join(vault.notebooksDir, entry), "utf8"))))
  );
  const matches = notebooks.filter((binding) => binding.topicId === topicId);

  if (matches.length === 0) {
    throw new Error(`Topic ${topicId} does not have a bound notebook. Bind a NotebookLM notebook to this topic first.`);
  }

  if (matches.length > 1) {
    throw new Error(`Topic ${topicId} has multiple notebook bindings. Select one explicitly with --notebook.`);
  }

  const [match] = matches;
  if (!match) {
    throw new Error(`Topic ${topicId} does not have a usable notebook binding.`);
  }

  return match.id;
}

export function getQuestionPlannerSetupMessage(): string {
  return `Use \`sourceloop plan-context ... --json\` to export planning context, author questions with the active agent, then pass them back with \`sourceloop plan ... --questions-file - --json\`. Set ${QUESTION_PLANNER_COMMAND_ENV} only if you still want an external planner command fallback.`;
}
