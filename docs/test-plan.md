# Test Plan

## Test Goal

Validate that SourceLoop can run the topic-first NotebookLM workflow end to end and leave behind an Obsidian-friendly Markdown archive that is readable, linked, and reusable.

## Scope

User-facing flows in scope:

- Workspace initialization
- Topic creation and inspection
- Topic-linked source ingest
- Chrome attach registration and validation
- Topic notebook binding
- Deep question planning
- NotebookLM run execution
- Markdown archive inspection in Obsidian

System areas in scope:

- `src/core/topics`
- `src/core/ingest`
- `src/core/attach`
- `src/core/notebooks`
- `src/core/runs`
- `src/core/notebooklm`
- Markdown rendering and archive link generation

## Priority

- High: attached Chrome execution, run completion, archive generation, broken-link risk
- Medium: topic state transitions, planner quality, corpus metadata consistency
- Low: optional output generation, markdown cosmetics, older legacy notebook-first fallback

## Automated Verification

Run:

```bash
pnpm build
pnpm test
```

Expected:

- TypeScript build succeeds
- Vitest suite passes
- Topic-first workflow tests pass
- Attach lifecycle tests pass
- Markdown output assertions pass

## Manual Verification

### 1. Workspace Bootstrap

Run:

```bash
sourceloop init <workspace>
```

Check:

- `.sourceloop/config.json` exists
- `vault/` subdirectories exist

### 2. Topic-First Setup

Run:

```bash
sourceloop topic create --name "Professional Web Design with Claude Code"
sourceloop topic list
sourceloop topic show <topic-id>
```

Check:

- topic is created
- `topic show` returns both topic and corpus metadata
- initial status is reasonable for the current corpus state

### 3. Source Ingest

Run:

```bash
sourceloop ingest <file-or-url> --topic <topic-id>
```

Check:

- `vault/sources/*.md` and `*.json` exist
- source markdown frontmatter uses human-readable `type: source`
- source note opens cleanly in Obsidian

### 4. Attach Existing Chrome

Precondition:

- Launch Chrome yourself with remote debugging enabled
- Sign in to NotebookLM manually

Run:

```bash
sourceloop attach endpoint --name work-chrome --endpoint http://127.0.0.1:9222
sourceloop attach validate attach-work-chrome --notebook-url <notebook-url> --show-browser
```

Check:

- Chrome is reachable
- NotebookLM notebook opens
- validation command returns to shell
- attached Chrome window remains open after validation

### 5. Notebook Binding

Run:

```bash
sourceloop notebook-bind \
  --name "Web Design Notebook" \
  --topic-id <topic-id> \
  --url <notebook-url> \
  --attach-target attach-work-chrome
```

Check:

- notebook markdown is created
- notebook note links back to topic and attach target

### 6. Deep Question Planning

Run:

```bash
sourceloop plan <topic-id>
```

Check:

- `vault/runs/<run-id>/questions.md` exists
- question document contains context links
- each planned question has a readable heading
- topic does not incorrectly jump to `researched` before any answers exist

### 7. NotebookLM Run

Run:

```bash
sourceloop run <run-id> --show-browser
```

Check:

- questions are submitted into NotebookLM
- answers are archived into `exchanges/*.md`
- shell prompt returns after completion
- attached Chrome window stays open
- run index links to completed exchanges

### 8. Obsidian Archive Review

Open:

```text
<workspace>/vault
```

Check:

- topic note links to corpus
- corpus links to sources, notebook, and runs
- run links to question batch and exchanges
- exchange links back to run, topic, question batch, and notebook
- titles and frontmatter feel readable enough for note-taking

## Failure and Edge Cases

- Attach validation against NotebookLM home instead of a specific notebook URL should fail clearly
- Invalid notebook URL should fail before run execution
- Run on a notebook with no usable query input should fail with a preflight error
- Already completed run should not duplicate archived exchanges
- Topic-like freeform text should not be misread as a real topic id

## Regression Checks

- Existing attached Chrome session must not be closed by SourceLoop
- Topic status must remain stable across `plan` and change only after real run progress
- Existing run archive links must remain valid after markdown rendering changes
- Legacy notebook-first planning path must still work where supported

## Visual Checks

Capture evidence for:

- successful `attach validate --show-browser`
- successful `run --show-browser`
- Obsidian view of topic, questions, and exchange notes

Recommended evidence:

- terminal output snippets
- one screenshot of NotebookLM during run
- one screenshot of Obsidian graph or linked notes view

## Execution Conditions

- Local Chrome installed
- NotebookLM access on the signed-in Google account
- Remote debugging Chrome session for attach tests
- Writable local workspace

## Exit Criteria

Validation is complete when:

- automated build and tests pass
- manual topic-first run completes against a real NotebookLM notebook
- archive notes are linked and readable in Obsidian
- attached Chrome lifecycle behaves correctly

Remaining known risks:

- NotebookLM DOM and selector changes can break browser automation
- citation capture is still weaker than the visible NotebookLM UI
- markdown note aesthetics can still be improved further
