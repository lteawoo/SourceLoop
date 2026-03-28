# LLM Playbook

## Goal

Use SourceLoop as a research operator that:

1. checks workspace state
2. fills missing prerequisites
3. prepares an attached Chrome session for NotebookLM
4. prepares a NotebookLM notebook
5. imports or declares evidence
6. plans bounded questions
7. runs small research batches
8. archives answers into the vault

NotebookLM remains the answer engine. SourceLoop is the setup, orchestration, and archive layer.

## Core Operating Loop

Every LLM-driven session should prefer this loop:

0. `sourceloop init --ai codex` when the workspace has not been bootstrapped yet
1. `sourceloop status --json`
2. `sourceloop doctor --json`
3. fix blocking prerequisites
4. run the next recommended command
5. re-check `status --json`

The agent should avoid guessing hidden state when the CLI can report it directly.

## Agent Rules

- Always start from `status --json` and `doctor --json`
- Always ensure the Chrome attach target is ready before notebook creation or execution
- Prefer `sourceloop chrome launch` so NotebookLM research uses a SourceLoop-managed isolated profile, not a shared default browsing profile
- Treat `sourceloop chrome launch` as the visible setup step for login and first NotebookLM checks
- After setup, prefer hidden notebook actions by default and add `--show-browser` only when debugging or when the user wants to watch
- Treat `sourceloop attach validate <target>` as NotebookLM home validation
- Use `sourceloop attach validate <target> --notebook-url ...` only when a specific existing notebook must open
- Classify the kickoff request before acting:
  - no topic provided
  - topic only
  - topic plus sources
  - existing NotebookLM URL
- If the user did not provide a topic, ask which topic to research before doing anything else
- If the user provided a topic but no sources, ask which sources to use before collecting or importing anything
- Do not autonomously search the web or choose source materials unless the user explicitly asked the agent to find sources
- Do not run `plan` unless the topic has usable evidence
- Do not run `run` unless the topic has a bound notebook and a planned run
- Prefer `notebook-create` + `notebook-import` when the notebook does not already exist
- Prefer `notebook-bind` + `notebook-source declare` when the notebook and source set already exist in NotebookLM
- Prefer small batches first:
  - `plan --max-questions 3` or `5`
  - `run --limit 1` or `2`
- Re-check state after each meaningful step

## NotebookLM First-Entry Rule

When entering NotebookLM, the agent should only verify:

1. NotebookLM home or the target notebook page opens
2. login is complete
3. the expected create or bind path is reachable

If any of those checks fail, the agent must not wander through the UI. It should stop and ask the user to fix login, access, or landing-page state first.
If only another Chrome is available, the agent must not silently continue on that path. It should ask the user whether to keep going with that Chrome or switch back to the SourceLoop browser first.

## Scenario 0: No Topic Provided

Use this when the user says "start research" or equivalent but does not provide a topic yet.

### Flow

- ask which topic to research
- stop there until the user answers
- do not create notebooks, import sources, or search for starter materials yet

## Scenario 1: Topic Only Kickoff

Use this when the user gives only a topic and no notebook URL or source bundle yet.

### Flow

```bash
sourceloop init --ai codex
sourceloop status --json
sourceloop doctor --json

sourceloop topic create --name "Attention in transformers" --json

sourceloop chrome launch --name work-chrome
sourceloop attach validate attach-work-chrome

sourceloop notebook-create \
  --name "Attention in Transformers" \
  --topic-id topic-attention-in-transformers \
  --attach-target attach-work-chrome \
  --json
```

### What happens next

- stop before planning
- ask the user which sources should be imported
- do not search the web or choose source materials unless the user explicitly asked for source finding
- use `notebook-import` for the first source even if the managed notebook is still empty
- continue only after usable evidence exists

## Scenario 2: Existing NotebookLM Notebook

Use this when the user already has a notebook and the source bundle is already loaded in NotebookLM.

### Flow

```bash
sourceloop init --ai codex
sourceloop status --json
sourceloop doctor --json

sourceloop topic create --name "AI agents market" --json

sourceloop chrome launch --name work-chrome
sourceloop attach validate attach-work-chrome

sourceloop notebook-bind \
  --name "AI Agents" \
  --topic-id topic-ai-agents-market \
  --url "https://notebooklm.google.com/notebook/<real-notebook-id>" \
  --attach-target attach-work-chrome \
  --json

sourceloop notebook-source declare \
  --topic-id topic-ai-agents-market \
  --notebook notebook-ai-agents \
  --kind youtube-playlist \
  --title "AI agents market source set" \
  --ref "https://youtube.com/playlist?list=<real-playlist-id>" \
  --json

sourceloop plan topic-ai-agents-market --max-questions 5 --families core,execution --json
sourceloop run <run-id> --limit 2 --show-browser --json
```

### When to use

- the user already prepared NotebookLM
- SourceLoop only needs to bind, declare evidence, and run research

## Scenario 3: Managed Notebook Setup

Use this when the user has source material but no prepared NotebookLM notebook.

### Flow

```bash
sourceloop init --ai codex
sourceloop status --json
sourceloop doctor --json

sourceloop topic create --name "AI agents market" --json

sourceloop chrome launch --name work-chrome
sourceloop attach validate attach-work-chrome

sourceloop notebook-create \
  --name "AI Agents" \
  --topic-id topic-ai-agents-market \
  --attach-target attach-work-chrome \
  --json

# first source import can target the newly created empty notebook directly
# managed notebook binding ids derive from the remote NotebookLM notebook id,
# so read the `notebook-create --json` output before using notebook-import
sourceloop ingest ./research-notes.md --topic topic-ai-agents-market

sourceloop notebook-import \
  --notebook <managed-notebook-binding-id> \
  --source-id <source-id> \
  --json

sourceloop notebook-import \
  --notebook <managed-notebook-binding-id> \
  --url "https://youtube.com/watch?v=<real-video-id>" \
  --json

sourceloop doctor --json
sourceloop plan topic-ai-agents-market --max-questions 5 --families core,execution --json
sourceloop run <run-id> --limit 2 --show-browser --json
```

### When to use

- the user gives local notes, URLs, or YouTube links
- the notebook should be created by SourceLoop
- the requested notebook title is only a display label; the durable binding id comes from the remote notebook resource id

## Scenario 4: Controlled Research Passes

Use bounded planning and execution by default.

### Recommended defaults

- first plan:
  - `--max-questions 3`
  - `--families core,execution`
- first run:
  - `--limit 1` or `2`

### Useful commands

```bash
sourceloop plan <topic-id> --max-questions 3 --families core,execution --json
sourceloop run <run-id> --limit 1 --json
sourceloop run <run-id> --from-question <question-id> --limit 2 --json
sourceloop run <run-id> --question-id <question-id> --json
```

## Scenario 5: Import an Existing Latest Answer

Use this when a reply already exists in NotebookLM and the agent wants to capture it without asking a new question.

```bash
sourceloop import-latest <run-id> --question-id <question-id> --show-browser
```

This is useful for manual correction or backfilling the latest visible answer.

## Decision Table

- `doctor` has `error`
  - fix the blocking prerequisite first
- no topic provided
  - ask which topic to research before doing anything else
- no trusted isolated Chrome target
  - launch the managed Chrome profile first
- managed isolated Chrome target exists but is still unvalidated
  - run URL-less `attach validate` first
- attach target isolation is `shared`, `unknown`, or only manually asserted isolated
  - surface the warning
  - ask the user whether to keep going with the current Chrome or switch back to `sourceloop chrome launch`
  - do not silently continue on that path
- topic only and no source bundle yet
  - create the notebook, then ask which sources to add
- topic provided but no sources requested
  - do not search for or choose source materials unless the user explicitly asked for source finding
- no notebook binding
  - create or bind a notebook
- notebook exists but no usable evidence
  - import or declare evidence
- topic is ready and no plan exists
  - create a plan
- plan exists and no completed exchanges
  - run a small batch
- run is incomplete
  - resume with `--from-question` or `--limit`

## Recommended User-Facing Narration

The agent should keep updates short and operational:

- "The topic exists, but there is no notebook binding yet. I will create a managed notebook."
- "The notebook is bound, but there is still no usable evidence. I will import the provided sources first."
- "The topic is ready for planning. I will generate a 5-question core and execution batch."
- "I will run only 2 questions first so we can check answer quality before expanding."

## Integration Model

The recommended first integration is:

1. the LLM agent invokes SourceLoop CLI commands directly
2. the agent parses `--json` outputs
3. the agent uses `status` and `doctor` as the main state API
4. the agent treats the attached Chrome session as a required operator-managed dependency
5. the agent treats NotebookLM as an external UI service, not as a direct API

This keeps the integration simple:

- no extra service layer is required
- the CLI remains the single contract
- the vault stays the durable local record

## Future Extensions

- current-thread backfill
- run reset / cleanup commands
- richer live doctor checks for NotebookLM browser state
- higher-level "research start" orchestration commands
