import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bindNotebook } from "../src/core/notebooks/bind-notebook.js";
import { declareNotebookSourceManifest } from "../src/core/notebooks/manage-notebook-source-manifests.js";
import { composeRun } from "../src/core/outputs/compose-run.js";
import { FixtureNotebookRunnerAdapter } from "../src/core/notebooklm/fixture-adapter.js";
import { createQuestionPlan } from "../src/core/runs/question-planner.js";
import { executeQARun, importLatestAnswerIntoRun } from "../src/core/runs/run-qa.js";
import { registerChromeEndpointTarget } from "../src/core/attach/manage-targets.js";
import { createTopic, loadTopic, refreshTopicArtifacts } from "../src/core/topics/manage-topics.js";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
import { ingestSource } from "../src/core/ingest/ingest-source.js";
import { resolvePlanInput } from "../src/commands/plan.js";
import { runCommand } from "../src/commands/run.js";
import { getExchangeNote, getTopicCorpusNote } from "../src/core/vault/notes.js";
import { loadWorkspace } from "../src/core/workspace/load-workspace.js";

describe("NotebookLM QA run archive", () => {
  it("creates a notebook-bound planned run and composes traceable outputs", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "AI Agents Notebook",
      topic: "ai-agents",
      notebookUrl: "https://notebooklm.google.com/notebook/example",
      accessMode: "owner",
      description: "NotebookLM target for AI agent research",
      topics: ["ai-agents", "notebooklm"]
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "ai agents market",
      notebookBindingId: binding.binding.id
    });

    const fixturePath = path.join(workspaceRoot, "fixture.json");
    const fixtureResponses = Object.fromEntries(
      plan.batch.questions.map((question, index) => [
        question.id,
        {
          answer: `Answer ${index + 1} for ${question.prompt}[1]`,
          citations: [
            {
              label: "1",
              sourcePath: `vault/sources/src_${index + 1}.md`
            }
          ]
        }
      ])
    );
    await writeFile(fixturePath, JSON.stringify(fixtureResponses, null, 2), "utf8");

    const runResult = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
    });

    expect(runResult.run.status).toBe("completed");
    expect(runResult.completedExchanges).toHaveLength(plan.batch.questions.length);

    const composed = await composeRun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      format: "brief"
    });

    const notebookMarkdown = await readFile(binding.markdownPath, "utf8");
    const workspace = await loadWorkspace(workspaceRoot);
    const runIndex = await readFile(plan.runMarkdownPath, "utf8");
    const questionsMarkdown = await readFile(plan.questionsMarkdownPath, "utf8");
    const firstExchangeNote = getExchangeNote(workspace, plan.run.id, plan.batch.questions[0]!);
    const exchangeMarkdown = await readFile(firstExchangeNote.absolutePath, "utf8");
    const outputMarkdown = await readFile(composed.markdownPath, "utf8");

    expect(notebookMarkdown).toContain("# AI Agents Notebook");
    expect(path.basename(binding.markdownPath)).toMatch(/^ai-agents-notebook-/);
    expect(path.basename(plan.runMarkdownPath)).toBe("ai-agents-market-run.md");
    expect(path.basename(plan.questionsMarkdownPath)).toBe("ai-agents-market-questions.md");
    expect(path.basename(firstExchangeNote.absolutePath)).not.toContain(plan.batch.questions[0]?.id ?? "");
    expect(runIndex).toContain(`status: completed`);
    expect(runIndex).toContain("type: run");
    expect(runIndex).toContain("[[");
    expect(runIndex).toContain("[[notebooks/");
    expect(runIndex).toContain("## Linked Exchanges");
    expect(runIndex).toContain("/outputs/");
    expect(questionsMarkdown).toContain(`type: questions`);
    expect(questionsMarkdown).toContain(`# ai agents market Questions`);
    expect(questionsMarkdown).not.toContain("families:");
    expect(questionsMarkdown).toContain("[[runs/");
    expect(exchangeMarkdown).toContain("## NotebookLM Answer");
    expect(exchangeMarkdown).toContain("answer_source: notebooklm");
    expect(exchangeMarkdown).toContain(`Answer 1 for ${plan.batch.questions[0]!.prompt} [[#^citation-1|[1]]]`);
    expect(exchangeMarkdown).toContain("^citation-1");
    expect(outputMarkdown).toContain("## Traceability");
    expect(outputMarkdown).toContain("[[");
    expect(outputMarkdown).toContain("type: output");
  });

  it("supports a topic-first research workflow with deep question planning metadata", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "AI agents market",
      goal: "Map the market structure and bottlenecks",
      intendedOutput: "lecture outline"
    });
    const sourcePath = path.join(workspaceRoot, "market-source.md");
    await writeFile(sourcePath, "AI agents market source material.", "utf8");
    await ingestSource({
      cwd: workspaceRoot,
      input: sourcePath,
      topicId: topic.topic.id
    });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "AI Agents Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/example",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: topic.topic.id
    });
    const plannedTopicState = await loadTopic(topic.topic.id, workspaceRoot);

    expect(plan.run.topicId).toBe(topic.topic.id);
    expect(plan.batch.topicId).toBe(topic.topic.id);
    expect(plan.batch.intendedOutput).toBe("lecture outline");
    expect(plan.batch.questionFamilies).toEqual(
      expect.arrayContaining(["core", "structure", "deep_dive", "comparison", "execution", "evidence_gap"])
    );
    expect(plan.batch.questions).toHaveLength(10);
    expect(plan.run.notebookBindingId).toBe(binding.binding.id);
    expect(plannedTopicState.topic.status).toBe("ready_for_planning");

    const fixturePath = path.join(workspaceRoot, "topic-fixture.json");
    const fixtureResponses = Object.fromEntries(
      plan.batch.questions.map((question, index) => [
        question.id,
        {
          answer: `Topic answer ${index + 1}`,
          citations: [{ label: `topic-source-${index + 1}` }]
        }
      ])
    );
    await writeFile(fixturePath, JSON.stringify(fixtureResponses, null, 2), "utf8");

    const runResult = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
    });
    const composed = await composeRun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      format: "outline"
    });

    const workspace = await loadWorkspace(workspaceRoot);
    const runIndex = await readFile(plan.runMarkdownPath, "utf8");
    const questionsMarkdown = await readFile(plan.questionsMarkdownPath, "utf8");
    const exchangeMarkdown = await readFile(getExchangeNote(workspace, plan.run.id, plan.batch.questions[0]!).absolutePath, "utf8");
    const outputMarkdown = await readFile(composed.markdownPath, "utf8");
    const refreshed = await loadTopic(topic.topic.id, workspaceRoot);

    expect(runResult.run.status).toBe("completed");
    expect(runIndex).toContain(`topic: "AI agents market"`);
    expect(runIndex).toContain("[[topics/");
    expect(runIndex).toContain("[[notebooks/");
    expect(questionsMarkdown).not.toContain("families:");
    expect(questionsMarkdown).toContain('output: "lecture outline"');
    expect(exchangeMarkdown).toContain(`topic: "AI agents market"`);
    expect(outputMarkdown).toContain(`format: outline`);
    expect(refreshed.topic.status).toBe("researched");
    expect(refreshed.corpus.notebookBindingIds).toContain(binding.binding.id);
    expect(refreshed.corpus.runIds).toContain(plan.run.id);
  });

  it("treats notebook-source manifests as topic corpus evidence", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Notebook-backed AI agents market"
    });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Notebook-backed Agents Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/notebook-backed",
      accessMode: "owner"
    });

    const manifest = await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: binding.binding.id,
      kind: "youtube-playlist",
      title: "AI agents playlist",
      refs: ["https://youtube.com/playlist?list=abc"]
    });

    const refreshed = await loadTopic(topic.topic.id, workspaceRoot);
    const workspace = await loadWorkspace(workspaceRoot);
    const corpusMarkdown = await readFile(getTopicCorpusNote(workspace, refreshed.topic).absolutePath, "utf8");

    expect(manifest.manifest.topicId).toBe(topic.topic.id);
    expect(refreshed.topic.status).toBe("ready_for_planning");
    expect(refreshed.corpus.sourceIds).toHaveLength(0);
    expect(refreshed.corpus.notebookBindingIds).toContain(binding.binding.id);
    expect(refreshed.corpus.notebookSourceManifestIds).toContain(manifest.manifest.id);
    expect(corpusMarkdown).toContain("## Notebook-backed Sources");
    expect(corpusMarkdown).toContain("AI agents playlist");
  });

  it("supports bounded planning and family-filter planning", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Planning Control Notebook",
      topic: "planning-controls",
      notebookUrl: "https://notebooklm.google.com/notebook/planning-controls",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "planning controls",
      notebookBindingId: binding.binding.id,
      maxQuestions: 3,
      families: ["core", "execution"]
    });

    const runMarkdown = await readFile(plan.runMarkdownPath, "utf8");
    const questionsMarkdown = await readFile(plan.questionsMarkdownPath, "utf8");

    expect(plan.batch.questions).toHaveLength(3);
    expect(plan.batch.questions.every((question) => ["core", "execution"].includes(question.kind))).toBe(true);
    expect(plan.batch.planningScope).toEqual({
      maxQuestions: 3,
      selectedFamilies: ["core", "execution"]
    });
    expect(plan.run.planningScope).toEqual({
      maxQuestions: 3,
      selectedFamilies: ["core", "execution"]
    });
    expect(runMarkdown).toContain("Planning Scope: legacy template planner | max 3 questions");
    expect(questionsMarkdown).toContain("max_questions: 3");
    expect(questionsMarkdown).not.toContain("selected_families:");
  });

  it("accepts AI-authored planned questions and applies the planning scope", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "AI Planned Notebook",
      topic: "ai-planned-topic",
      notebookUrl: "https://notebooklm.google.com/notebook/ai-planned-topic",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "ai planned topic",
      notebookBindingId: binding.binding.id,
      maxQuestions: 2,
      families: ["comparison", "execution"],
      questions: [
        {
          kind: "core",
          objective: "Clarify the thesis.",
          prompt: "What is the central thesis behind ai planned topic?"
        },
        {
          kind: "comparison",
          objective: "Compare the most relevant playbooks.",
          prompt: "Which competing playbooks matter most for ai planned topic, and where does each one break?"
        },
        {
          kind: "execution",
          objective: "Turn the research into an operating checklist.",
          prompt: "What execution checklist should someone follow to apply ai planned topic in a real team?"
        },
        {
          kind: "evidence_gap",
          objective: "Expose the weakest claims.",
          prompt: "Which claims around ai planned topic still need direct verification?"
        }
      ]
    });

    expect(plan.batch.questions).toHaveLength(2);
    expect(plan.batch.questionFamilies).toEqual(["comparison", "execution"]);
    expect(plan.batch.questions[0]).toMatchObject({
      kind: "comparison",
      objective: "Compare the most relevant playbooks.",
      prompt: "Which competing playbooks matter most for ai planned topic, and where does each one break?",
      order: 0
    });
    expect(plan.batch.questions[1]).toMatchObject({
      kind: "execution",
      objective: "Turn the research into an operating checklist.",
      prompt: "What execution checklist should someone follow to apply ai planned topic in a real team?",
      order: 1
    });
  });

  it("rejects empty AI-authored question arrays instead of falling back to template planning", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Empty AI Planned Notebook",
      topic: "empty-ai-planned-topic",
      notebookUrl: "https://notebooklm.google.com/notebook/empty-ai-planned-topic",
      accessMode: "owner"
    });

    await expect(
      createQuestionPlan({
        cwd: workspaceRoot,
        topic: "empty ai planned topic",
        notebookBindingId: binding.binding.id,
        questions: []
      })
    ).rejects.toThrow("Question planning requires at least one AI-authored question draft.");
  });

  it("fails topic-first planning when the topic corpus and notebook binding are misaligned", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const marketTopic = await createTopic({
      cwd: workspaceRoot,
      name: "AI agents market",
      goal: "Study the market",
      intendedOutput: "brief"
    });
    const otherTopic = await createTopic({
      cwd: workspaceRoot,
      name: "Agentic engineering",
      goal: "Study engineering patterns",
      intendedOutput: "brief"
    });

    const sourcePath = path.join(workspaceRoot, "market-source.md");
    await writeFile(sourcePath, "Market source material.", "utf8");
    await ingestSource({
      cwd: workspaceRoot,
      input: sourcePath,
      topicId: marketTopic.topic.id
    });

    const foreignBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Engineering Notebook",
      topic: otherTopic.topic.name,
      topicId: otherTopic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/engineering",
      accessMode: "owner"
    });

    await expect(
      createQuestionPlan({
        cwd: workspaceRoot,
        topicId: marketTopic.topic.id,
        notebookBindingId: foreignBinding.binding.id
      })
    ).rejects.toThrow(/belongs to .*not topic|corpus does not include notebook binding/i);
  });

  it("allows topic-first runs when notebook-backed evidence exists without local source notes", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Notebook-backed planning topic"
    });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Notebook-backed Planning Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/notebook-backed-planning",
      accessMode: "owner"
    });

    await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: binding.binding.id,
      kind: "document-set",
      title: "Bound document set"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: topic.topic.id
    });

    const fixturePath = path.join(workspaceRoot, "manifest-only-fixture.json");
    const fixtureResponses = Object.fromEntries(
      plan.batch.questions.map((question, index) => [
        question.id,
        {
          answer: `Manifest-backed answer ${index + 1}`,
          citations: [{ label: `${index + 1}` }]
        }
      ])
    );
    await writeFile(fixturePath, JSON.stringify(fixtureResponses, null, 2), "utf8");

    const runResult = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
    });

    expect(runResult.run.status).toBe("completed");
  });

  it("requires notebook-backed evidence to align with the specific bound notebook", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Multi notebook topic"
    });

    const primaryBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Primary Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/primary",
      accessMode: "owner"
    });
    const secondaryBinding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Secondary Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/secondary",
      accessMode: "owner"
    });

    await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: primaryBinding.binding.id,
      kind: "youtube-playlist",
      title: "Primary notebook evidence"
    });

    await expect(
      createQuestionPlan({
        cwd: workspaceRoot,
        topicId: topic.topic.id,
        notebookBindingId: secondaryBinding.binding.id
      })
    ).rejects.toThrow(/aligned to notebook binding|for this notebook/i);
  });

  it("drops notebook-backed evidence from topic readiness when its bound notebook disappears", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Stale notebook evidence topic"
    });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Ephemeral Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/ephemeral",
      accessMode: "owner"
    });

    const manifest = await declareNotebookSourceManifest({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: binding.binding.id,
      kind: "document-set",
      title: "Ephemeral evidence"
    });

    let refreshed = await loadTopic(topic.topic.id, workspaceRoot);
    expect(refreshed.topic.status).toBe("ready_for_planning");
    expect(refreshed.corpus.notebookSourceManifestIds).toContain(manifest.manifest.id);

    await rm(path.join(workspaceRoot, "vault", "notebooks", `${binding.binding.id}.json`), { force: true });
    await rm(binding.markdownPath, { force: true });

    const updated = await refreshTopicArtifacts(topic.topic.id, workspaceRoot);
    expect(updated.topic.status).toBe("initialized");
    expect(updated.corpus.notebookBindingIds).toHaveLength(0);
    expect(updated.corpus.notebookSourceManifestIds).toHaveLength(0);
  });

  it("fails topic-first runs when neither local sources nor notebook-backed evidence exist", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Unbacked topic"
    });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Unbacked Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/unbacked",
      accessMode: "owner"
    });

    const fixturePath = path.join(workspaceRoot, "unbacked-fixture.json");
    await writeFile(fixturePath, JSON.stringify({}, null, 2), "utf8");

    await expect(
      createQuestionPlan({
        cwd: workspaceRoot,
        topicId: topic.topic.id,
        notebookBindingId: binding.binding.id
      })
    ).rejects.toThrow(/no declared evidence|notebook-source manifest/i);

    const sourcePath = path.join(workspaceRoot, "unbacked-source.md");
    await writeFile(sourcePath, "fallback source", "utf8");
    await ingestSource({
      cwd: workspaceRoot,
      input: sourcePath,
      topicId: topic.topic.id
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: topic.topic.id,
      notebookBindingId: binding.binding.id
    });

    await expect(
      executeQARun({
        cwd: workspaceRoot,
        runId: plan.run.id,
        adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
      })
    ).resolves.toMatchObject({
      run: {
        status: "incomplete"
      }
    });
  });

  it("treats topic-like legacy strings as freeform topics when no topic artifact exists", async () => {
    const resolved = await resolvePlanInput("topic-market-map", {
      notebook: "notebook-legacy-notebook"
    });

    expect(resolved).toEqual({
      topic: "topic-market-map",
      notebookBindingId: "notebook-legacy-notebook",
      requireAiPlanner: true
    });
  });

  it("supports targeted and limited run execution scopes", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Run Control Notebook",
      topic: "run-controls",
      notebookUrl: "https://notebooklm.google.com/notebook/run-controls",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "run controls",
      notebookBindingId: binding.binding.id
    });

    const fixturePath = path.join(workspaceRoot, "run-controls-fixture.json");
    const fixtureResponses = Object.fromEntries(
      plan.batch.questions.map((question, index) => [
        question.id,
        {
          answer: `Scoped answer ${index + 1}`,
          citations: [{ label: `${index + 1}` }]
        }
      ])
    );
    await writeFile(fixturePath, JSON.stringify(fixtureResponses, null, 2), "utf8");

    const scopedResult = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath),
      fromQuestionId: plan.batch.questions[2]!.id,
      limit: 2
    });

    expect(scopedResult.run.status).toBe("running");
    expect(scopedResult.completedExchanges).toHaveLength(2);
    expect(scopedResult.run.executionScope).toEqual({
      fromQuestionId: plan.batch.questions[2]!.id,
      limit: 2
    });
    expect(new Set(scopedResult.run.completedQuestionIds)).toEqual(
      new Set([plan.batch.questions[2]!.id, plan.batch.questions[3]!.id])
    );

    const targetedResult = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath),
      questionIds: [plan.batch.questions[1]!.id, plan.batch.questions[6]!.id]
    });

    expect(targetedResult.run.status).toBe("running");
    expect(targetedResult.run.executionScope).toEqual({
      questionIds: [plan.batch.questions[1]!.id, plan.batch.questions[6]!.id]
    });
    expect(new Set(targetedResult.run.completedQuestionIds)).toEqual(
      new Set([
        plan.batch.questions[2]!.id,
        plan.batch.questions[3]!.id,
        plan.batch.questions[1]!.id,
        plan.batch.questions[6]!.id
      ])
    );

    const runMarkdown = await readFile(plan.runMarkdownPath, "utf8");
    expect(runMarkdown).toContain(`Execution Scope: questions: ${plan.batch.questions[1]!.id}, ${plan.batch.questions[6]!.id}`);
  });

  it("clears stale execution scope when a later run executes with default remaining-question behavior", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Execution Scope Reset Notebook",
      topic: "execution-scope-reset",
      notebookUrl: "https://notebooklm.google.com/notebook/execution-scope-reset",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "execution scope reset",
      notebookBindingId: binding.binding.id
    });

    const fixturePath = path.join(workspaceRoot, "execution-scope-reset-fixture.json");
    const fixtureResponses = Object.fromEntries(
      plan.batch.questions.map((question, index) => [
        question.id,
        {
          answer: `Reset answer ${index + 1}`,
          citations: [{ label: `${index + 1}` }]
        }
      ])
    );
    await writeFile(fixturePath, JSON.stringify(fixtureResponses, null, 2), "utf8");

    const firstPass = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath),
      fromQuestionId: plan.batch.questions[2]!.id,
      limit: 2
    });
    expect(firstPass.run.executionScope).toEqual({
      fromQuestionId: plan.batch.questions[2]!.id,
      limit: 2
    });

    const secondPass = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
    });

    expect(secondPass.run.executionScope).toBeUndefined();
    const runMarkdown = await readFile(plan.runMarkdownPath, "utf8");
    expect(runMarkdown).toContain("Execution Scope: remaining planned questions");
  });

  it("rejects conflicting run selector options", async () => {
    runCommand.exitOverride();
    await expect(
      runCommand.parseAsync(["run-id", "--question-id", "q01", "--from-question", "q02"], {
        from: "user"
      })
    ).rejects.toThrow(/cannot be used together/i);
  });

  it("still creates a plan when the bound attach target artifact is missing", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });
    const attachTarget = await registerChromeEndpointTarget({
      cwd: workspaceRoot,
      name: "Missing Target",
      endpoint: "http://127.0.0.1:9222"
    });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Notebook With Missing Attach Target",
      topic: "missing-attach",
      notebookUrl: "https://notebooklm.google.com/notebook/example",
      accessMode: "owner",
      attachTargetId: attachTarget.target.id
    });

    await rm(path.join(workspaceRoot, "vault", "chrome-targets", `${attachTarget.target.id}.json`), { force: true });
    await rm(attachTarget.markdownPath, { force: true });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "missing attach planning",
      notebookBindingId: binding.binding.id
    });

    const runMarkdown = await readFile(plan.runMarkdownPath, "utf8");

    expect(plan.run.status).toBe("planned");
    expect(runMarkdown).toContain(`Attach Target: ${attachTarget.target.id}`);
  });

  it("does not silently overwrite an existing notebook binding without --force", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    await bindNotebook({
      cwd: workspaceRoot,
      name: "Duplicate Notebook",
      topic: "duplicates",
      notebookUrl: "https://notebooklm.google.com/notebook/one",
      accessMode: "owner"
    });

    await expect(
      bindNotebook({
        cwd: workspaceRoot,
        name: "Duplicate Notebook",
        topic: "duplicates",
        notebookUrl: "https://notebooklm.google.com/notebook/two",
        accessMode: "owner"
      })
    ).rejects.toThrow(/already exists/);
  });

  it("preserves completed exchanges when a later question fails", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Failure Notebook",
      topic: "failure-case",
      notebookUrl: "https://notebooklm.google.com/notebook/failure",
      accessMode: "shared"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "failure handling",
      notebookBindingId: binding.binding.id
    });

    const failingQuestion = plan.batch.questions[1];
    const fixturePath = path.join(workspaceRoot, "fixture-partial.json");
    const fixtureResponses = Object.fromEntries(
      plan.batch.questions.map((question, index) => [
        question.id,
        {
          answer: `Partial answer ${index + 1}`,
          fail: question.id === failingQuestion?.id
        }
      ])
    );
    await writeFile(fixturePath, JSON.stringify(fixtureResponses, null, 2), "utf8");

    const runResult = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
    });

    expect(runResult.run.status).toBe("incomplete");
    expect(runResult.run.failedQuestionId).toBe(failingQuestion?.id);
    expect(runResult.completedExchanges).toHaveLength(1);

    const workspace = await loadWorkspace(workspaceRoot);
    const firstExchangePath = getExchangeNote(workspace, plan.run.id, plan.batch.questions[0]!).absolutePath;
    const secondExchangePath = getExchangeNote(workspace, plan.run.id, failingQuestion!).absolutePath;
    const firstExchange = await readFile(firstExchangePath, "utf8");

    expect(firstExchange).toContain("Partial answer 1");
    await expect(readFile(secondExchangePath, "utf8")).rejects.toThrow();
  });

  it("composes exchanges in planned question order", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Ordering Notebook",
      topic: "ordering",
      notebookUrl: "https://notebooklm.google.com/notebook/ordering",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "ordering test",
      notebookBindingId: binding.binding.id
    });

    const fixturePath = path.join(workspaceRoot, "ordering-fixture.json");
    const reversed = [...plan.batch.questions].reverse();
    const fixtureResponses = Object.fromEntries(
      reversed.map((question, index) => [
        question.id,
        {
          answer: `Ordered answer ${index + 1}`
        }
      ])
    );
    await writeFile(fixturePath, JSON.stringify(fixtureResponses, null, 2), "utf8");

    await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
    });

    const composed = await composeRun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      format: "outline"
    });

    const outputMarkdown = await readFile(composed.markdownPath, "utf8");
    const firstQuestionTitle = plan.batch.questions[0]?.prompt ?? "";
    const secondQuestionTitle = plan.batch.questions[1]?.prompt ?? "";

    expect(outputMarkdown.indexOf(firstQuestionTitle)).toBeLessThan(outputMarkdown.indexOf(secondQuestionTitle));
  });

  it("falls back to generic deep questions when a topic has no goal or output hints", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "Professional Web Design with Claude Code"
    });
    const sourcePath = path.join(workspaceRoot, "design-source.md");
    await writeFile(sourcePath, "Design source material.", "utf8");
    await ingestSource({
      cwd: workspaceRoot,
      input: sourcePath,
      topicId: topic.topic.id
    });
    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Design Notebook",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/design",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: topic.topic.id
    });

    expect(binding.binding.id).toBe(plan.run.notebookBindingId);
    expect(plan.batch.objective).toContain("Research Professional Web Design with Claude Code");
    expect(plan.batch.intendedOutput).toBeUndefined();
    expect(plan.batch.questions).toHaveLength(10);
  });

  it("keeps non-ASCII titles in human-readable note filenames", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const topic = await createTopic({
      cwd: workspaceRoot,
      name: "클로드 코드 웹디자인"
    });
    const sourcePath = path.join(workspaceRoot, "korean-source.md");
    await writeFile(sourcePath, "한글 소스입니다.", "utf8");
    await ingestSource({
      cwd: workspaceRoot,
      input: sourcePath,
      topicId: topic.topic.id
    });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "웹디자인 노트북",
      topic: topic.topic.name,
      topicId: topic.topic.id,
      notebookUrl: "https://notebooklm.google.com/notebook/example",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: topic.topic.id
    });

    expect(path.basename(binding.markdownPath)).toContain("웹디자인-노트북");
    expect(path.basename(plan.runMarkdownPath)).toContain("클로드-코드-웹디자인-run");
    expect(path.basename(plan.questionsMarkdownPath)).toContain("클로드-코드-웹디자인-questions");
  });

  it("imports the latest NotebookLM answer into the next unanswered planned question", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Latest Import Notebook",
      topic: "latest-import",
      notebookUrl: "https://notebooklm.google.com/notebook/latest-import",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "latest answer import",
      notebookBindingId: binding.binding.id
    });

    const firstImport = await importLatestAnswerIntoRun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      answer: {
        answer: "Imported answer one",
        citations: [{ label: "1", note: "Imported source" }],
        answerSource: "notebooklm"
      }
    });

    expect(firstImport.importedQuestionId).toBe(plan.batch.questions[0]?.id);
    expect(firstImport.run.status).toBe("running");

    const secondImport = await importLatestAnswerIntoRun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      answer: {
        answer: "Imported answer two",
        citations: [{ label: "2", note: "Imported source two" }],
        answerSource: "notebooklm"
      },
      questionId: plan.batch.questions[1]?.id
    });

    expect(secondImport.importedQuestionId).toBe(plan.batch.questions[1]?.id);

    const workspace = await loadWorkspace(workspaceRoot);
    const firstExchangeMarkdown = await readFile(
      getExchangeNote(workspace, plan.run.id, plan.batch.questions[0]!).absolutePath,
      "utf8"
    );
    expect(firstExchangeMarkdown).toContain("Imported answer one");
    expect(firstExchangeMarkdown).toContain("Imported source");
  });

  it("rejects loading text during latest-answer import instead of recording it as a completed exchange", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Placeholder Import Notebook",
      topic: "placeholder-import",
      notebookUrl: "https://notebooklm.google.com/notebook/placeholder-import",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "placeholder import",
      notebookBindingId: binding.binding.id,
      maxQuestions: 1
    });

    await expect(
      importLatestAnswerIntoRun({
        cwd: workspaceRoot,
        runId: plan.run.id,
        answer: {
          answer: "Getting the gist...",
          citations: [],
          answerSource: "notebooklm"
        }
      })
    ).rejects.toThrow(/loading|placeholder|answer/i);
  });

  it("marks a run incomplete when the notebook adapter returns loading text", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "sourceloop-"));
    await initializeWorkspace({ directory: workspaceRoot, force: false });

    const binding = await bindNotebook({
      cwd: workspaceRoot,
      name: "Placeholder Run Notebook",
      topic: "placeholder-run",
      notebookUrl: "https://notebooklm.google.com/notebook/placeholder-run",
      accessMode: "owner"
    });

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topic: "placeholder run",
      notebookBindingId: binding.binding.id,
      maxQuestions: 1
    });

    const fixturePath = path.join(workspaceRoot, "placeholder-fixture.json");
    await writeFile(
      fixturePath,
      JSON.stringify(
        {
          [plan.batch.questions[0]!.id]: {
            answer: "Getting the context...",
            citations: [{ label: "1", note: "NotebookLM loading text" }]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const runResult = await executeQARun({
      cwd: workspaceRoot,
      runId: plan.run.id,
      adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
    });

    expect(runResult.run.status).toBe("incomplete");
    expect(runResult.run.failedQuestionId).toBe(plan.batch.questions[0]?.id);
    expect(runResult.completedExchanges).toHaveLength(0);
  });
});
