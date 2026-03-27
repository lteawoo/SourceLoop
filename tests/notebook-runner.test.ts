import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bindNotebook } from "../src/core/notebooks/bind-notebook.js";
import { composeRun } from "../src/core/outputs/compose-run.js";
import { FixtureNotebookRunnerAdapter } from "../src/core/notebooklm/fixture-adapter.js";
import { createQuestionPlan } from "../src/core/runs/question-planner.js";
import { executeQARun } from "../src/core/runs/run-qa.js";
import { registerChromeEndpointTarget } from "../src/core/attach/manage-targets.js";
import { createTopic, loadTopic } from "../src/core/topics/manage-topics.js";
import { initializeWorkspace } from "../src/core/workspace/init-workspace.js";
import { ingestSource } from "../src/core/ingest/ingest-source.js";
import { resolvePlanInput } from "../src/commands/plan.js";
import { getExchangeNote } from "../src/core/vault/notes.js";
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
          answer: `Answer ${index + 1} for ${question.prompt}`,
          citations: [
            {
              label: `source-${index + 1}`,
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
    expect(questionsMarkdown).toContain("families:");
    expect(questionsMarkdown).toContain("[[runs/");
    expect(exchangeMarkdown).toContain("## NotebookLM Answer");
    expect(exchangeMarkdown).toContain("answer_source: notebooklm");
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
    expect(questionsMarkdown).toContain("families:");
    expect(questionsMarkdown).toContain('output: "lecture outline"');
    expect(exchangeMarkdown).toContain(`topic: "AI agents market"`);
    expect(outputMarkdown).toContain(`format: outline`);
    expect(refreshed.topic.status).toBe("researched");
    expect(refreshed.corpus.notebookBindingIds).toContain(binding.binding.id);
    expect(refreshed.corpus.runIds).toContain(plan.run.id);
  });

  it("fails topic-first runs before execution when the topic corpus and notebook binding are misaligned", async () => {
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

    const plan = await createQuestionPlan({
      cwd: workspaceRoot,
      topicId: marketTopic.topic.id,
      notebookBindingId: foreignBinding.binding.id
    });

    const fixturePath = path.join(workspaceRoot, "misaligned-fixture.json");
    await writeFile(fixturePath, JSON.stringify({}, null, 2), "utf8");

    await expect(
      executeQARun({
        cwd: workspaceRoot,
        runId: plan.run.id,
        adapter: await FixtureNotebookRunnerAdapter.fromFile(fixturePath)
      })
    ).rejects.toThrow(/targets topic|attached to/i);

    const runIndex = JSON.parse(await readFile(path.join(plan.runDir, "index.json"), "utf8")) as {
      status: string;
      failureReason?: string;
    };

    expect(runIndex.status).toBe("failed");
    expect(runIndex.failureReason).toMatch(/targets topic|attached to/i);
  });

  it("treats topic-like legacy strings as freeform topics when no topic artifact exists", async () => {
    const resolved = await resolvePlanInput("topic-market-map", {
      notebook: "notebook-legacy-notebook"
    });

    expect(resolved).toEqual({
      topic: "topic-market-map",
      notebookBindingId: "notebook-legacy-notebook"
    });
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
});
