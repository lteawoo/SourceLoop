import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const SUPPORTED_AGENT_BOOTSTRAPS = ["codex"] as const;

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
  if (input.ai !== "codex") {
    throw new Error(`Unsupported AI bootstrap target: ${input.ai}`);
  }

  const skillDir = path.join(input.rootDir, ".codex", "skills", "sourceloop-operator");
  if (!input.force && (await pathExists(skillDir))) {
    throw new Error(
      `Codex bootstrap already exists at ${skillDir}. Re-run with --force to overwrite the generated scaffold.`
    );
  }
}

export async function bootstrapWorkspaceAgent(input: {
  rootDir: string;
  ai: SupportedAgentBootstrap;
  force: boolean;
}): Promise<WorkspaceBootstrapResult> {
  await validateWorkspaceAgentBootstrap(input);

  return bootstrapCodexWorkspace(input.rootDir, input.force);
}

async function bootstrapCodexWorkspace(rootDir: string, force: boolean): Promise<WorkspaceBootstrapResult> {
  const skillDir = path.join(rootDir, ".codex", "skills", "sourceloop-operator");
  const referencesDir = path.join(skillDir, "references");
  const skillPath = path.join(skillDir, "SKILL.md");
  const playbookPath = path.join(referencesDir, "playbook.md");

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

1. Run \`sourceloop status --json\`
2. Run \`sourceloop doctor --json\`
3. Fix blocking prerequisites before planning or running
4. Prepare the managed browser before notebook creation or execution
5. Choose the kickoff path:
   - no topic provided
   - topic only
   - topic plus sources
   - existing NotebookLM URL
6. Prepare notebook before evidence import or declaration
7. Require usable evidence before planning
8. Prefer bounded execution:
   - \`plan --max-questions 3\` or \`5\`
   - \`run --limit 1\` or \`2\`
9. Re-check \`status --json\` after each meaningful step

## NotebookLM entry rules

- Only verify deterministic entry checks:
  - NotebookLM home or target notebook opens
  - the user is logged in
  - create/bind flow is reachable
- If these checks fail, do not wander through the UI.
- Stop and ask the user to fix login, permissions, or landing-page state.
- If only another Chrome is available, do not silently continue on that path.
- Ask the user whether to keep going with that Chrome or switch back to the SourceLoop browser first.

## Kickoff paths

- Topic only:
  - create the topic if needed
  - prepare attached Chrome
  - create a managed notebook
  - ask the user which sources to import before planning
- No topic provided:
  - ask the user which topic to research
  - do not create notebooks, import sources, or plan questions yet
- Topic plus sources:
  - create the topic if needed
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
- No trusted isolated Chrome target: \`sourceloop chrome launch\`
- Treat \`sourceloop chrome launch\` as the visible setup step for login and first NotebookLM checks
- Managed isolated Chrome target exists but is not validated yet: \`sourceloop attach validate <target>\`
- Topic only and no notebook yet: \`sourceloop notebook-create ...\` then ask for source inputs
- Topic plus sources and no notebook yet: \`sourceloop notebook-create ...\`
- Existing NotebookLM URL: \`sourceloop notebook-bind ...\` then \`sourceloop notebook-source declare ...\`
- Local source files: \`sourceloop ingest ...\` then \`sourceloop notebook-import --source-id ...\` (also for the first source on an empty managed notebook)
- Remote URLs: \`sourceloop notebook-import --url ...\` (also for the first source on an empty managed notebook)
- For SourceLoop-managed notebooks, treat the requested notebook title as a label only and read the returned binding id from JSON or \`status --json\`
- Ready topic with no run: \`sourceloop plan ... --max-questions 3 --families core,execution --json\`
- Planned or incomplete run: \`sourceloop run ... --limit 1 --json\`
- Existing latest answer only: \`sourceloop import-latest ...\`

## Safety

- Do not skip \`status --json\` and \`doctor --json\`
- Do not freestyle inside NotebookLM when the first entry checks fail
- Treat shared or unknown Chrome profile isolation as a warning that should be surfaced before more NotebookLM work
- Do not silently fall back to another Chrome session
- Ask the user before continuing with a non-SourceLoop browser
- Do not autonomously search the web or choose source materials unless the user explicitly asked you to find sources
- Do not run \`plan\` without usable evidence
- Do not run \`run\` without a notebook binding and planned run
- Do not use \`--question-id\` and \`--from-question\` together
- Do not default to large run batches

For the full operator flow, read [references/playbook.md](references/playbook.md).
`;
}

function buildCodexPlaybookReference(): string {
  return `# SourceLoop Codex Playbook

## Preferred order

1. \`sourceloop status --json\`
2. \`sourceloop doctor --json\`
3. topic preparation
4. managed isolated Chrome / NotebookLM session preparation
5. \`chrome launch\`
6. \`attach validate\`
7. \`notebook-create\` or \`notebook-bind\`
8. \`ingest\`, \`notebook-import\`, or \`notebook-source declare\`
9. \`status --json\` and \`doctor --json\` again
10. \`plan --max-questions 3|5 --families core,execution --json\`
11. \`run --limit 1|2 --json\`

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
- If only another Chrome is available, do not silently continue on that path.
- Ask the user whether to keep going with that Chrome or switch back to the SourceLoop browser first.

## Decision rules

- If doctor has errors, resolve them first.
- Prefer \`sourceloop chrome launch\` so NotebookLM research uses a SourceLoop-managed isolated profile instead of a shared default browser profile.
- Use \`chrome launch\` as the visible setup step, then keep later notebook actions hidden unless you need \`--show-browser\` for debugging.
- Prefer URL-less \`sourceloop attach validate <target>\` before notebook creation when only NotebookLM home readiness is needed.
- If the user did not provide a topic, ask for the topic first and stop there.
- If no trusted isolated Chrome target exists, launch browser state before notebook actions.
- If only another Chrome is available, ask the user whether to keep going with that Chrome before using it.
- If the user provided only a topic, create a managed notebook and ask which sources to import.
- If the user did not provide sources, do not search for or choose source materials unless the user explicitly asked you to find sources.
- If the user provided topic plus sources, create a managed notebook and import those sources.
- If the user provided a NotebookLM URL, bind the existing notebook and continue from its source state.
- If a run already exists, resume with bounded execution instead of creating large new passes.
`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
