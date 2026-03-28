# SourceLoop

SourceLoop is a local-first research runner that connects a topic, a NotebookLM notebook, and an attached Chrome session into a reusable Markdown archive.

It is designed for the workflow:

1. A human chooses a topic
2. SourceLoop organizes local source notes around that topic
3. NotebookLM answers a planned set of deep questions
4. SourceLoop archives the Q&A as Obsidian-friendly Markdown
5. Final expression stays human-owned

SourceLoop is not a NotebookLM replacement. It is an orchestration and archive layer for topic-based NotebookLM research.

## What It Does

- Creates topic-first research roots
- Stores local source notes and topic corpus metadata
- Registers already signed-in Chrome targets
- Binds a NotebookLM notebook to a topic
- Generates deep planned research questions with bounded scope controls
- Runs NotebookLM Q&A through an attached Chrome session with partial execution controls
- Archives runs, questions, and answers into an Obsidian-friendly vault

## Workflow

```text
Topic
-> Sources
-> Notebook Binding
-> Deep Question Plan
-> NotebookLM Run
-> Markdown Q&A Archive
```

## Preferred Usage

```bash
sourceloop init <workspace>
cd <workspace>

sourceloop topic create --name "AI agents market"
sourceloop ingest ./sources/market-map.md --topic topic-ai-agents-market

# sign in to NotebookLM in Chrome yourself first
sourceloop attach endpoint --name work-chrome --endpoint http://127.0.0.1:9222

sourceloop notebook-bind \
  --name "AI Agents" \
  --topic-id topic-ai-agents-market \
  --url "https://notebooklm.google.com/notebook/..." \
  --attach-target attach-work-chrome

sourceloop plan topic-ai-agents-market --max-questions 5 --families core,execution
sourceloop run <run-id> --from-question <question-id> --limit 2 --show-browser
```

## Vault Structure

```text
vault/
├─ chrome-targets/
├─ notebooks/
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
- Source ingestion beyond local notes and basic URLs

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Reference docs:

- [Architecture](./docs/architecture.md)
- [Tasks](./docs/tasks.md)
- [Test Plan](./docs/test-plan.md)
