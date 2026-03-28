# SourceLoop

SourceLoop is a local-first research runner that connects a topic, a NotebookLM notebook, and an attached Chrome session into a reusable Markdown archive.

It is designed for the workflow:

1. A human chooses a topic
2. SourceLoop records local sources or notebook-backed source manifests around that topic
3. NotebookLM answers a planned set of deep questions
4. SourceLoop archives the Q&A as Obsidian-friendly Markdown
5. Final expression stays human-owned

SourceLoop is not a NotebookLM replacement. It is an orchestration and archive layer for topic-based NotebookLM research.

## What It Does

- Creates topic-first research roots
- Stores local source notes and topic corpus metadata
- Declares notebook-backed source manifests for material already loaded into NotebookLM
- Registers already signed-in Chrome targets
- Binds a NotebookLM notebook to a topic
- Generates deep planned research questions with bounded scope controls
- Runs NotebookLM Q&A through an attached Chrome session with partial execution controls
- Archives runs, questions, and answers into an Obsidian-friendly vault

## Workflow

```text
Topic
-> Sources / Notebook-backed Source Declarations
-> Notebook Binding
-> Deep Question Plan
-> NotebookLM Run
-> Markdown Q&A Archive
```

## Preferred Usage

```bash
sourceloop init <workspace>
cd <workspace>

sourceloop status
sourceloop doctor

sourceloop topic create --name "AI agents market"

# sign in to NotebookLM in Chrome yourself first
sourceloop attach endpoint --name work-chrome --endpoint http://127.0.0.1:9222

sourceloop notebook-bind \
  --name "AI Agents" \
  --topic-id topic-ai-agents-market \
  --url "https://notebooklm.google.com/notebook/..." \
  --attach-target attach-work-chrome

sourceloop notebook-source declare \
  --topic-id topic-ai-agents-market \
  --notebook notebook-ai-agents \
  --kind youtube-playlist \
  --title "AI agents market source set" \
  --ref "https://youtube.com/playlist?list=..."

sourceloop plan topic-ai-agents-market --max-questions 5 --families core,execution
sourceloop run <run-id> --from-question <question-id> --limit 2 --show-browser
```

## Operator Commands

- `sourceloop status`
  - shows the current workspace summary, open runs, and recommended next actions
- `sourceloop doctor`
  - reports missing notebook bindings, missing evidence, broken attach references, and incomplete runs
- `--json`
  - supported on the core workflow commands used by operators and LLM agents:
    - `topic create|list|show`
    - `notebook-bind`
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
sourceloop plan topic-ai-agents-market --max-questions 3 --json
sourceloop run <run-id> --limit 1 --json
```

## Vault Structure

```text
vault/
├─ chrome-targets/
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

sourceloop --help
```

Reference docs:

- [Architecture](./docs/architecture.md)
- [Tasks](./docs/tasks.md)
- [Test Plan](./docs/test-plan.md)
