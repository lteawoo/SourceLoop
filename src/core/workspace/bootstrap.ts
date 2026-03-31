import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const SUPPORTED_AGENT_BOOTSTRAPS = ["codex", "claude", "gemini"] as const;

export type SupportedAgentBootstrap = (typeof SUPPORTED_AGENT_BOOTSTRAPS)[number];

export type WorkspaceBootstrapResult = {
  ai: SupportedAgentBootstrap;
  created: string[];
};

export async function validateWorkspaceAgentBootstrap(input: {
  rootDir: string;
  ai: SupportedAgentBootstrap;
  force: boolean;
}): Promise<void> {
  switch (input.ai) {
    case "codex": {
      const skillDir = getSkillDir(input.rootDir, input.ai);
      if (!input.force && (await pathExists(skillDir))) {
        throw new Error(
          `Codex bootstrap already exists at ${skillDir}. Re-run with --force to overwrite the generated scaffold.`
        );
      }
      return;
    }
    case "claude": {
      const skillDir = getSkillDir(input.rootDir, input.ai);
      if (!input.force && (await pathExists(skillDir))) {
        throw new Error(
          `Claude bootstrap already exists at ${skillDir}. Re-run with --force to overwrite the generated scaffold.`
        );
      }
      return;
    }
    case "gemini": {
      const skillDir = getSkillDir(input.rootDir, input.ai);
      if (!input.force && (await pathExists(skillDir))) {
        throw new Error(
          `Gemini bootstrap already exists at ${skillDir}. Re-run with --force to overwrite the generated scaffold.`
        );
      }
      return;
    }
    default:
      throw new Error(`Unsupported AI bootstrap target: ${input.ai}`);
  }
}

export async function bootstrapWorkspaceAgent(input: {
  rootDir: string;
  ai: SupportedAgentBootstrap;
  force: boolean;
}): Promise<WorkspaceBootstrapResult> {
  await validateWorkspaceAgentBootstrap(input);

  switch (input.ai) {
    case "codex":
      return bootstrapCodexWorkspace(input.rootDir, input.force);
    case "claude":
      return bootstrapClaudeWorkspace(input.rootDir, input.force);
    case "gemini":
      return bootstrapGeminiWorkspace(input.rootDir, input.force);
    default:
      throw new Error(`Unsupported AI bootstrap target: ${input.ai}`);
  }
}

async function bootstrapCodexWorkspace(rootDir: string, force: boolean): Promise<WorkspaceBootstrapResult> {
  const { skillDir, referencesDir, skillPath, playbookPath } = getBootstrapPaths(rootDir, "codex");

  if (force && (await pathExists(skillDir))) {
    await rm(skillDir, { recursive: true, force: true });
  }

  await mkdir(referencesDir, { recursive: true });
  await writeFile(skillPath, buildCodexSkillMarkdown(), "utf8");
  await writeFile(playbookPath, buildCodexPlaybookReference(), "utf8");

  return {
    ai: "codex",
    created: [
      path.relative(rootDir, skillPath),
      path.relative(rootDir, playbookPath)
    ]
  };
}

function buildCodexSkillMarkdown(): string {
  return `---
name: sourceloop-operator
description: Operate a SourceLoop workspace with the standard research loop. Use when working inside a SourceLoop project and you need to inspect state, prepare NotebookLM, choose the right kickoff path, import or declare evidence, plan questions, and run bounded research passes.
---

Use this skill when the current project is a SourceLoop workspace.

## Core loop

1. If the workspace is not bootstrapped yet, run \`sourceloop init --ai <codex|claude|gemini>\`
2. Run \`sourceloop status --json\`
3. Run \`sourceloop doctor --json\`
4. Fix blocking prerequisites before planning or running
5. Prepare the managed browser before notebook creation or execution
6. Choose the kickoff path:
   - no topic provided
   - topic only
   - topic plus sources
   - existing NotebookLM URL
7. Prepare notebook before evidence import or declaration
8. Require usable evidence before planning
9. Execution defaults:
   - planning defaults to 10 questions unless the user asked for a different count
   - prefer AI-authored topic-specific questions when the operator can generate them, and pass them into \`sourceloop plan\` with \`--questions-file\`
   - once a 10-question batch is planned, prefer running the full batch unless the user explicitly asked for a smaller partial pass
10. Re-check \`status --json\` after each meaningful step
11. If a NotebookLM step may take a while, say so briefly before waiting
12. If a run command already has a chosen \`--limit\`, let that command finish its full requested scope before asking what to do next
13. While waiting on login, permission, or NotebookLM entry readiness, do not fill the gap with outside summaries, source analysis, or speculative prep work

## NotebookLM entry rules

- Only verify deterministic entry checks:
  - NotebookLM home or target notebook opens
  - the user is logged in
  - create/bind flow is reachable
- If these checks fail, do not wander through the UI.
- Stop and ask the user to fix login, permissions, or landing-page state.
- While blocked on login or NotebookLM entry readiness, do not switch to summarizing sources, collecting web material, or drafting answer content in parallel.
- If only another Chrome is available, do not silently continue on that path.
- Ask the user whether to keep going with that Chrome or switch back to the SourceLoop browser first.

## Kickoff paths

- Topic only:
  - create the topic if needed
  - confirm the planned question count at kickoff (default: 10)
  - prepare attached Chrome
  - create a managed notebook
  - ask the user which sources to import before planning
- No topic provided:
  - ask the user which topic to research
  - mention that the default planned question count is 10 and they can change it now
  - do not create notebooks, import sources, or plan questions yet
- Topic plus sources:
  - create the topic if needed
  - confirm the planned question count at kickoff (default: 10)
  - prepare attached Chrome
  - create a managed notebook
  - import the provided files or URLs
  - plan only after evidence is usable
- Existing NotebookLM URL:
  - bind the existing notebook
  - declare notebook-backed evidence if the sources already exist there
  - otherwise ask which sources still need to be added
  - do not search for replacement source materials unless the user explicitly asks you to find them
  - if only another Chrome is available, ask the user before continuing

## Command selection

- No topic: \`sourceloop topic create ...\`
- User asked to start research without a topic: ask which topic to research before doing anything else
- When asking for the topic, also mention that the default planned question count is 10 and the user can override it
- Workspace not bootstrapped yet: \`sourceloop init --ai <codex|claude|gemini>\`
- No trusted isolated Chrome target: \`sourceloop chrome launch\`
- Treat \`sourceloop chrome launch\` as the visible setup step for login and first NotebookLM checks
- If a stale SourceLoop-managed browser needs to be cleaned up directly: \`sourceloop chrome close <target>\`
- Managed isolated Chrome target exists but is not validated yet: \`sourceloop attach validate <target>\`
- Topic only and no notebook yet: \`sourceloop notebook-create ...\` then ask for source inputs
- Topic plus sources and no notebook yet: \`sourceloop notebook-create ...\`
- Existing NotebookLM URL: \`sourceloop notebook-bind ...\` then \`sourceloop notebook-source declare ...\`
- Local source files: \`sourceloop ingest ...\` then \`sourceloop notebook-import --source-id ...\` (also for the first source on an empty managed notebook)
- Remote URLs: \`sourceloop notebook-import --url ...\` (also for the first source on an empty managed notebook)
- For SourceLoop-managed notebooks, treat the requested notebook title as a label only and read the returned binding id from JSON or \`status --json\`
- Prefer \`sourceloop plan ... --questions-file ./ai-questions.json --json\` when the operator has already generated a topic-specific question batch
- Ready topic with no run: \`sourceloop plan ... --max-questions 10 --json\`
- Planned or incomplete run: \`sourceloop run ... --json\`
- Existing latest answer only: \`sourceloop import-latest ...\`
- Treat \`--limit\` as the execution scope for one run command. Do not stop halfway through that requested limit just to ask again.
- After \`run\` or \`import-latest\` finishes generating the requested answer output, the SourceLoop-managed Chrome should be closed.

## Safety

- Do not skip \`status --json\` and \`doctor --json\`
- Do not freestyle inside NotebookLM when the first entry checks fail
- Treat shared or unknown Chrome profile isolation as a warning that should be surfaced before more NotebookLM work
- Do not silently fall back to another Chrome session
- Ask the user before continuing with a non-SourceLoop browser
- Do not autonomously search the web or choose source materials unless the user explicitly asked you to find sources
- Do not do sidecar source analysis or answer drafting while waiting for the user to finish NotebookLM login or other entry blockers
- Do not run \`plan\` without usable evidence
- Do not run \`run\` without a notebook binding and planned run
- Do not use \`--question-id\` and \`--from-question\` together
- Do not impose a partial run limit by default when the planned batch should be executed end to end
- Do not turn bounded execution into per-question interruptions unless the user explicitly asked for checkpoint-style approval
- Do not leave a SourceLoop-managed Chrome running after answer generation finishes unless the user explicitly asked to keep it open

For the full operator flow, read [references/playbook.md](references/playbook.md).
`;
}

function buildCodexPlaybookReference(): string {
  return `# SourceLoop Codex Playbook

## Preferred order

1. \`sourceloop init --ai <codex|claude|gemini>\` when the workspace has not been bootstrapped yet
2. \`sourceloop status --json\`
3. \`sourceloop doctor --json\`
4. topic preparation
5. managed isolated Chrome / NotebookLM session preparation
6. \`chrome launch\`
7. \`attach validate\`
8. \`notebook-create\` or \`notebook-bind\`
9. \`ingest\`, \`notebook-import\`, or \`notebook-source declare\`
10. \`status --json\` and \`doctor --json\` again
11. \`plan --max-questions 10 --json\`
12. \`run --json\`

## Start conditions

The operator should classify the user's first request into one of these:

1. no topic provided
2. topic only
3. topic plus sources
4. existing NotebookLM URL

## First-entry rules for NotebookLM

- Check only the expected entry state:
  - NotebookLM home opens
  - login is complete
  - create or bind flow is reachable
- If any of these checks fail, do not explore the UI further.
- Stop and ask the user to fix login, permissions, or landing-page state.
- While blocked on login or NotebookLM entry readiness, do not switch to summarizing sources, collecting web material, or drafting answer content in parallel.
- If only another Chrome is available, do not silently continue on that path.
- Ask the user whether to keep going with that Chrome or switch back to the SourceLoop browser first.

## Decision rules

- If doctor has errors, resolve them first.
- Prefer \`sourceloop chrome launch\` so NotebookLM research uses a SourceLoop-managed isolated profile instead of a shared default browser profile.
- Use \`chrome launch\` as the visible setup step, then keep later notebook actions hidden unless you need \`--show-browser\` for debugging.
- Use \`sourceloop chrome close <target>\` when a stale SourceLoop-managed browser should be closed directly.
- Prefer URL-less \`sourceloop attach validate <target>\` before notebook creation when only NotebookLM home readiness is needed.
- If the user did not provide a topic, ask for the topic first and mention that planning defaults to 10 questions unless they want another count.
- If no trusted isolated Chrome target exists, launch browser state before notebook actions.
- If only another Chrome is available, ask the user whether to keep going with that Chrome before using it.
- If the user provided only a topic, confirm the question count (default: 10), create a managed notebook, and ask which sources to import.
- If the user did not provide sources, do not search for or choose source materials unless the user explicitly asked you to find sources.
- If the user provided topic plus sources, create a managed notebook and import those sources.
- If the user provided a NotebookLM URL, bind the existing notebook and continue from its source state.
- If a run already exists, resume it before creating a new pass.
- If the user planned 10 questions and did not ask for a partial pass, run the full remaining batch instead of adding a default \`--limit\`.
- If you already chose a bounded run command such as \`run --limit 1\`, let that command complete before asking whether to continue with another run.
- Tell the user that NotebookLM actions can take a bit before you wait on them, and if the wait becomes long, ask whether to keep waiting or just report the current state.
- While blocked on login, permission prompts, or NotebookLM entry readiness, wait on that blocker only instead of doing outside source analysis in parallel.
- After \`run\` or \`import-latest\` completes and the requested answer output has been generated, the SourceLoop-managed Chrome should be closed automatically unless the user explicitly asked to keep it open.
`;
}

async function bootstrapClaudeWorkspace(rootDir: string, force: boolean): Promise<WorkspaceBootstrapResult> {
  const { skillDir, referencesDir, skillPath, playbookPath } = getBootstrapPaths(rootDir, "claude");

  if (force && (await pathExists(skillDir))) {
    await rm(skillDir, { recursive: true, force: true });
  }

  await mkdir(referencesDir, { recursive: true });
  await writeFile(skillPath, buildClaudeSkillMarkdown(), "utf8");
  await writeFile(playbookPath, buildSharedPlaybookReference(), "utf8");

  return {
    ai: "claude",
    created: [
      path.relative(rootDir, skillPath),
      path.relative(rootDir, playbookPath)
    ]
  };
}

async function bootstrapGeminiWorkspace(rootDir: string, force: boolean): Promise<WorkspaceBootstrapResult> {
  const { skillDir, referencesDir, skillPath, playbookPath } = getBootstrapPaths(rootDir, "gemini");

  if (force && (await pathExists(skillDir))) {
    await rm(skillDir, { recursive: true, force: true });
  }

  await mkdir(referencesDir, { recursive: true });
  await writeFile(skillPath, buildGeminiSkillMarkdown(), "utf8");
  await writeFile(playbookPath, buildSharedPlaybookReference(), "utf8");

  return {
    ai: "gemini",
    created: [
      path.relative(rootDir, skillPath),
      path.relative(rootDir, playbookPath)
    ]
  };
}

function buildClaudeSkillMarkdown(): string {
  return `---
name: sourceloop-operator
description: Operate a SourceLoop workspace with the standard research loop. Use when working inside a SourceLoop project and you need to inspect state, prepare NotebookLM, choose the right kickoff path, import or declare evidence, plan questions, and run bounded research passes.
---

Use this skill when the current project is a SourceLoop workspace.

## Core loop

1. If the workspace is not bootstrapped yet, run \`sourceloop init --ai <codex|claude|gemini>\`
2. Run \`sourceloop status --json\`
3. Run \`sourceloop doctor --json\`
4. Fix blocking prerequisites before planning or running
5. Prepare the managed browser before notebook creation or execution
6. Choose the kickoff path:
   - no topic provided
   - topic only
   - topic plus sources
   - existing NotebookLM URL
7. Prepare notebook before evidence import or declaration
8. Require usable evidence before planning
9. Planning defaults to 10 questions unless the user asked for another count
10. Prefer AI-authored topic-specific questions when the operator can generate them, and pass them into \`sourceloop plan\` with \`--questions-file\`
11. Once a 10-question batch is planned, prefer running the full batch unless the user explicitly asked for a smaller partial pass
12. Re-check \`sourceloop status --json\` after each meaningful step

## NotebookLM entry rules

- Only verify deterministic entry checks:
  - NotebookLM home or target notebook opens
  - the user is logged in
  - create or bind flow is reachable
- If these checks fail, do not wander through the UI.
- Stop and ask the user to fix login, permissions, or landing-page state.
- While blocked on login or NotebookLM entry readiness, do not switch to summarizing sources, collecting web material, or drafting answer content in parallel.
- If only another Chrome is available, do not silently continue on that path.
- Ask the user whether to keep going with that Chrome or switch back to the SourceLoop browser first.

## Command selection

- Workspace not bootstrapped yet: \`sourceloop init --ai <codex|claude|gemini>\`
- No trusted isolated Chrome target: \`sourceloop chrome launch\`
- If a stale SourceLoop-managed browser needs to be cleaned up directly: \`sourceloop chrome close <target>\`
- Managed isolated Chrome target exists but is not validated yet: \`sourceloop attach validate <target>\`
- Topic only and no notebook yet: \`sourceloop notebook-create ...\`, then ask which sources to import
- Topic plus sources and no notebook yet: \`sourceloop notebook-create ...\`, then import the provided files or URLs
- Existing NotebookLM URL: \`sourceloop notebook-bind ...\`, then \`sourceloop notebook-source declare ...\`
- Local source files: \`sourceloop ingest ...\`, then \`sourceloop notebook-import --source-id ...\`
- Remote URLs: \`sourceloop notebook-import --url ...\`
- Prefer \`sourceloop plan ... --questions-file ./ai-questions.json --json\` when the operator has already generated a topic-specific question batch
- Ready topic with no run: \`sourceloop plan ... --max-questions 10 --json\`
- Planned or incomplete run: \`sourceloop run ... --json\`
- Existing latest answer only: \`sourceloop import-latest ...\`
- After \`run\` or \`import-latest\` finishes generating the requested answer output, the SourceLoop-managed Chrome should be closed.

## Safety

- Do not skip \`status --json\` and \`doctor --json\`
- Do not freestyle inside NotebookLM when the first entry checks fail
- Treat shared or unknown Chrome profile isolation as a warning that should be surfaced before more NotebookLM work
- Do not silently fall back to another Chrome session
- Do not autonomously search the web or choose source materials unless the user explicitly asked you to find sources
- Do not do sidecar source analysis or answer drafting while waiting for the user to finish NotebookLM login or other entry blockers
- Do not run \`plan\` without usable evidence
- Do not run \`run\` without a notebook binding and planned run
- Do not use \`--question-id\` and \`--from-question\` together
- Do not impose a partial run limit by default when the planned batch should be executed end to end
- Do not leave a SourceLoop-managed Chrome running after answer generation finishes unless the user explicitly asked to keep it open

For the full operator flow, read [references/playbook.md](references/playbook.md).
`;
}

function buildGeminiSkillMarkdown(): string {
  return `---
name: sourceloop-operator
description: Operate a SourceLoop workspace with the standard research loop. Use when working inside a SourceLoop project and you need to inspect state, prepare NotebookLM, choose the right kickoff path, import or declare evidence, plan questions, and run bounded research passes.
---

Use this skill when the current project is a SourceLoop workspace.

## Core loop

1. If the workspace is not bootstrapped yet, run \`sourceloop init --ai <codex|claude|gemini>\`
2. Run \`sourceloop status --json\`
3. Run \`sourceloop doctor --json\`
4. Fix blocking prerequisites before planning or running
5. Prepare the managed browser before notebook creation or execution
6. Choose the kickoff path:
   - no topic provided
   - topic only
   - topic plus sources
   - existing NotebookLM URL
7. Prepare notebook before evidence import or declaration
8. Require usable evidence before planning
9. Planning defaults to 10 questions unless the user asked for another count
10. Prefer AI-authored topic-specific questions when the operator can generate them, and pass them into \`sourceloop plan\` with \`--questions-file\`
11. Once a 10-question batch is planned, prefer running the full batch unless the user explicitly asked for a smaller partial pass
12. Re-check \`sourceloop status --json\` after each meaningful step

## NotebookLM entry rules

- Only verify deterministic entry checks:
  - NotebookLM home or target notebook opens
  - the user is logged in
  - create or bind flow is reachable
- If these checks fail, do not wander through the UI.
- Stop and ask the user to fix login, permissions, or landing-page state.
- While blocked on login or NotebookLM entry readiness, do not switch to summarizing sources, collecting web material, or drafting answer content in parallel.
- If only another Chrome is available, do not silently continue on that path.
- Ask the user whether to keep going with that Chrome or switch back to the SourceLoop browser first.

## Command selection

- Workspace not bootstrapped yet: \`sourceloop init --ai <codex|claude|gemini>\`
- No trusted isolated Chrome target: \`sourceloop chrome launch\`
- If a stale SourceLoop-managed browser needs to be cleaned up directly: \`sourceloop chrome close <target>\`
- Managed isolated Chrome target exists but is not validated yet: \`sourceloop attach validate <target>\`
- Topic only and no notebook yet: \`sourceloop notebook-create ...\`, then ask which sources to import
- Topic plus sources and no notebook yet: \`sourceloop notebook-create ...\`, then import the provided files or URLs
- Existing NotebookLM URL: \`sourceloop notebook-bind ...\`, then \`sourceloop notebook-source declare ...\`
- Local source files: \`sourceloop ingest ...\`, then \`sourceloop notebook-import --source-id ...\`
- Remote URLs: \`sourceloop notebook-import --url ...\`
- Prefer \`sourceloop plan ... --questions-file ./ai-questions.json --json\` when the operator has already generated a topic-specific question batch
- Ready topic with no run: \`sourceloop plan ... --max-questions 10 --json\`
- Planned or incomplete run: \`sourceloop run ... --json\`
- Existing latest answer only: \`sourceloop import-latest ...\`
- After \`run\` or \`import-latest\` finishes generating the requested answer output, the SourceLoop-managed Chrome should be closed.

## Safety

- Do not skip \`status --json\` and \`doctor --json\`
- Do not freestyle inside NotebookLM when the first entry checks fail
- Treat shared or unknown Chrome profile isolation as a warning that should be surfaced before more NotebookLM work
- Do not silently fall back to another Chrome session
- Do not autonomously search the web or choose source materials unless the user explicitly asked you to find sources
- Do not do sidecar source analysis or answer drafting while waiting for the user to finish NotebookLM login or other entry blockers
- Do not run \`plan\` without usable evidence
- Do not run \`run\` without a notebook binding and planned run
- Do not use \`--question-id\` and \`--from-question\` together
- Do not impose a partial run limit by default when the planned batch should be executed end to end
- Do not leave a SourceLoop-managed Chrome running after answer generation finishes unless the user explicitly asked to keep it open

For the full operator flow, read [references/playbook.md](references/playbook.md).
`;
}

function buildSharedPlaybookReference(): string {
  return `# SourceLoop Operator Playbook

## Preferred order

1. \`sourceloop init --ai <codex|claude|gemini>\` when the workspace has not been bootstrapped yet
2. \`sourceloop status --json\`
3. \`sourceloop doctor --json\`
4. topic preparation
5. managed isolated Chrome / NotebookLM session preparation
6. \`chrome launch\`
7. \`attach validate\`
8. \`notebook-create\` or \`notebook-bind\`
9. \`ingest\`, \`notebook-import\`, or \`notebook-source declare\`
10. \`status --json\` and \`doctor --json\` again
11. \`plan --max-questions 10 --json\`
12. \`run --json\`

## Decision rules

- If doctor has errors, resolve them first.
- Prefer \`sourceloop chrome launch\` so NotebookLM research uses a SourceLoop-managed isolated profile instead of a shared default browser profile.
- Use \`sourceloop chrome close <target>\` when a stale SourceLoop-managed browser should be closed directly.
- Prefer URL-less \`sourceloop attach validate <target>\` before notebook creation when only NotebookLM home readiness is needed.
- If the user did not provide a topic, ask for the topic first and mention that planning defaults to 10 questions unless they want another count.
- If no trusted isolated Chrome target exists, launch browser state before notebook actions.
- If only another Chrome is available, ask the user whether to keep going with that Chrome before using it.
- If NotebookLM login or entry readiness is blocking the workflow, do not spend that waiting time producing outside source summaries or speculative answer drafts.
- If the user provided only a topic, confirm the question count, create a managed notebook, and ask which sources to import.
- If the user did not provide sources, do not search for or choose source materials unless the user explicitly asked you to find sources.
- If the user provided topic plus sources, create a managed notebook and import those sources.
- If the user provided a NotebookLM URL, bind the existing notebook and continue from its source state.
- If a run already exists, resume it before creating a new pass.
- If the user planned 10 questions and did not ask for a partial pass, run the full remaining batch instead of adding a default \`--limit\`.
- After \`run\` or \`import-latest\` completes and the requested answer output has been generated, the SourceLoop-managed Chrome should be closed automatically unless the user explicitly asked to keep it open.
`;
}

function getBootstrapPaths(rootDir: string, ai: SupportedAgentBootstrap) {
  const skillDir = getSkillDir(rootDir, ai);
  const referencesDir = path.join(skillDir, "references");
  const skillPath = path.join(skillDir, "SKILL.md");
  const playbookPath = path.join(referencesDir, "playbook.md");

  return {
    skillDir,
    referencesDir,
    skillPath,
    playbookPath
  };
}

function getSkillDir(rootDir: string, ai: SupportedAgentBootstrap): string {
  switch (ai) {
    case "codex":
      return path.join(rootDir, ".codex", "skills", "sourceloop-operator");
    case "claude":
      return path.join(rootDir, ".claude", "skills", "sourceloop-operator");
    case "gemini":
      return path.join(rootDir, ".agents", "skills", "sourceloop-operator");
    default:
      throw new Error(`Unsupported AI bootstrap target: ${ai}`);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
