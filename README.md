# SourceLoop

SourceLoop is a local-first research runner that connects a topic, a NotebookLM notebook, and an attached Chrome session into a reusable Markdown archive.

It is designed for the workflow:

1. A human chooses a topic
2. SourceLoop creates or binds a NotebookLM notebook for that topic
3. SourceLoop records local sources, imports managed sources, or declares notebook-backed source manifests
4. NotebookLM answers a planned set of deep questions
5. SourceLoop archives the Q&A as Obsidian-friendly Markdown
6. Final expression stays human-owned

SourceLoop is not a NotebookLM replacement. It is an orchestration and archive layer for topic-based NotebookLM research.

## What It Does

- Creates topic-first research roots
- Stores local source notes and topic corpus metadata
- Creates managed NotebookLM notebooks through an attached Chrome session
- Imports local sources and supported remote URLs into managed notebooks
- Declares notebook-backed source manifests for material already loaded into NotebookLM
- Registers already signed-in Chrome targets
- Binds a NotebookLM notebook to a topic
- Generates deep planned research questions with bounded scope controls
- Runs NotebookLM Q&A through an attached Chrome session with partial execution controls
- Archives runs, questions, and answers into an Obsidian-friendly vault

## Workflow

```text
Topic
-> Attached Chrome / NotebookLM Session Ready
-> Managed Notebook Create or Existing Notebook Bind
-> Source Imports / Notebook-backed Source Declarations
-> Deep Question Plan
-> NotebookLM Run
-> Markdown Q&A Archive
```

## Preferred Usage

```bash
mkdir my-research-workspace
cd my-research-workspace
sourceloop init --ai codex

sourceloop status
sourceloop doctor

sourceloop topic create --name "AI agents market"

# launch a dedicated Chrome research profile, sign in to NotebookLM yourself, then attach it
sourceloop chrome launch --name work-chrome
sourceloop attach validate \
  attach-work-chrome \
  --notebook-url "https://notebooklm.google.com/notebook/<real-notebook-id>"

sourceloop notebook-create \
  --name "AI Agents" \
  --topic-id topic-ai-agents-market \
  --attach-target attach-work-chrome

# managed notebook binding ids now derive from the remote NotebookLM notebook id
# so read the returned JSON or status output for the exact binding id before importing
# the first managed import works even when the notebook is still empty
sourceloop ingest ./research-notes.md --topic topic-ai-agents-market

sourceloop notebook-import \
  --notebook <managed-notebook-binding-id> \
  --source-id <source-id>

sourceloop notebook-import \
  --notebook <managed-notebook-binding-id> \
  --url "https://youtube.com/watch?v=..."

sourceloop plan topic-ai-agents-market --max-questions 5 --families core,execution
sourceloop run <run-id> --from-question <question-id> --limit 2 --show-browser
```

If the notebook already exists and already has sources loaded in NotebookLM, keep using:

```bash
sourceloop notebook-bind ...
sourceloop notebook-source declare ...
```

## Operator Commands

- `sourceloop status`
  - shows the current workspace summary, open runs, and recommended next actions
- `sourceloop doctor`
  - reports missing notebook bindings, missing evidence, broken attach references, and incomplete runs
- `--json`
  - supported on the core workflow commands used by operators and LLM agents:
    - `topic create|list|show`
    - `notebook-create`
    - `notebook-bind`
    - `notebook-import`
    - `notebook-source declare|list|show`
    - `plan`
    - `run`
    - `status`
    - `doctor`

Example machine-readable flow:

```bash
sourceloop status --json
sourceloop doctor --json
sourceloop topic create --name "AI agents market" --json
sourceloop chrome launch --name work-chrome
sourceloop notebook-create --name "AI Agents" --topic-id topic-ai-agents-market --attach-target attach-work-chrome --json
# works for the first source on an empty managed notebook and for later add-source imports
sourceloop notebook-import --notebook <managed-notebook-binding-id> --url "https://youtube.com/watch?v=..." --json
sourceloop plan topic-ai-agents-market --max-questions 3 --json
sourceloop run <run-id> --limit 1 --json
```

SourceLoop recommends `sourceloop chrome launch` as the preferred NotebookLM browser setup. Shared or unknown browser profiles still work in this phase, but `doctor` and `status` will warn so operators do not treat them as the preferred setup.
For SourceLoop-managed notebooks, NotebookLM titles are treated as best-effort labels. The durable local binding id comes from the remote NotebookLM notebook id, so operators should use the returned JSON or `status --json` output rather than guessing a slug from the requested title.

## Vault Structure

```text
vault/
├─ chrome-targets/
├─ notebook-imports/
├─ notebook-setups/
├─ notebooks/
├─ notebook-sources/
├─ runs/
├─ sources/
└─ topics/
```

The main result is the run archive:

```text
vault/runs/<run-id>/
├─ index.md
├─ questions.md
└─ exchanges/
   ├─ q01....md
   ├─ q02....md
   └─ ...
```

## Project Boundary

SourceLoop stops at research packaging and Q&A archive creation.

- Humans choose the topic
- NotebookLM answers from the bound notebook
- SourceLoop stores the research trace
- Humans turn that archive into slides, scripts, memos, lessons, or deliverables

## Status

Current focus:

- Topic-first NotebookLM workflow
- Managed notebook setup workflow
- Attached Chrome execution
- Obsidian-friendly Markdown archive

Still rough around:

- NotebookLM UI selector stability
- Citation capture fidelity
- Automatic NotebookLM source introspection beyond operator-declared manifests

## Development

```bash
pnpm install
pnpm build
pnpm test
```

For local CLI usage:

```bash
pnpm install
pnpm build
pnpm link --global

sourceloop init --ai codex
sourceloop --help
```

Reference docs:

- [Architecture](./docs/architecture.md)
- [LLM Playbook](./docs/llm-playbook.md)
- [Tasks](./docs/tasks.md)
- [Test Plan](./docs/test-plan.md)
