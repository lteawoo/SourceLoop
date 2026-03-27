# SourceLoop Task Breakdown

## Task Goal

- build the exact workflow described in the post as a repeatable NotebookLM-centered pipeline: package sources, generate better questions, capture answers locally, and turn them into reusable deliverables.

## Task List

### 1. Project Scaffolding

- Purpose: establish the executable base for the CLI project.
- Prerequisites: none.
- Outputs: package manifest, TypeScript config, source layout, test setup.
- Done criteria: `sourceloop --help` runs and test commands execute.

### 2. Workspace Bootstrap

- Purpose: define the local structure for sources, bundles, runs, and outputs.
- Prerequisites: project scaffolding.
- Outputs: `init` command, config schema, folder bootstrap logic.
- Done criteria: a new workspace creates the full folder layout in one command.

### 3. Canonical Source Schema

- Purpose: standardize how normalized source files are represented.
- Prerequisites: project scaffolding.
- Outputs: validation schemas and TypeScript types for source metadata and file contracts.
- Done criteria: valid source files serialize consistently and invalid metadata is rejected.

### 4. Local File Ingest

- Purpose: prove the normalization pipeline on the simplest input type.
- Prerequisites: workspace bootstrap and source schema.
- Outputs: ingest command for `.md` and `.txt` files.
- Done criteria: a local file becomes a canonical Markdown source with frontmatter.

### 5. URL Ingest

- Purpose: support the most important research input path.
- Prerequisites: local file ingest and source schema.
- Outputs: fetch and extract command for web pages.
- Done criteria: a reachable URL becomes a canonical Markdown source with title and source URI.

### 6. Basic PDF Ingest

- Purpose: cover the third MVP source type used in the post’s workflow.
- Prerequisites: workspace bootstrap and source schema.
- Outputs: PDF text extraction plus canonical Markdown output.
- Done criteria: a readable PDF becomes a source file with metadata and extracted text.

### 7. Topic Bundle Builder

- Purpose: package sources into NotebookLM-ready upload groups.
- Prerequisites: ingest flows and source schema.
- Outputs: `notebook-pack` command, bundle manifest, topic bundle directory.
- Done criteria: a topic produces a bundle folder and manifest listing included sources.

### 8. Question Planning

- Purpose: generate structured research questions for a specific topic.
- Prerequisites: bundle builder and model/template strategy.
- Outputs: `plan` command, `questions.md`, `questions.json`, run metadata.
- Done criteria: a run is created with ordered core, deep-dive, comparison, and execution questions.

### 9. Answer Capture Format

- Purpose: define exactly how NotebookLM answers are recorded back into SourceLoop.
- Prerequisites: question planning.
- Outputs: answer template, citation schema, operator note format.
- Done criteria: one captured answer file can be validated and traced back to a question and bundle.

### 10. Manual-First Capture Command

- Purpose: make the answer capture loop practical before browser automation.
- Prerequisites: answer capture format.
- Outputs: `capture` command that scaffolds answer files or imports structured answer text.
- Done criteria: a full research run can be populated with stored answers and citations without editing arbitrary files by hand.

### 11. Compose Command

- Purpose: convert captured Q&A into usable research outputs.
- Prerequisites: captured answers.
- Outputs: `compose` command with at least `brief` and `outline` formats.
- Done criteria: one completed run can generate a briefing and an outline with links back to the captured answers.

### 12. MCP Adapter

- Purpose: expose the pipeline to Codex and Claude Code.
- Prerequisites: stable CLI commands.
- Outputs: MCP tools for `init`, `ingest`, `notebook-pack`, `plan`, `capture`, and `compose`.
- Done criteria: an agent can execute the whole workflow through tools rather than ad hoc shell commands.

### 13. Validation and Fixtures

- Purpose: keep the workflow stable as supported source types grow.
- Prerequisites: core ingest, bundle, planning, capture, and compose flows.
- Outputs: fixture sources, command tests, regression checks for file formats.
- Done criteria: core flows pass deterministic tests locally.

## Recommended Order

1. Project scaffolding
2. Workspace bootstrap
3. Canonical source schema
4. Local file ingest
5. URL ingest
6. Topic bundle builder
7. Question planning
8. Answer capture format
9. Manual-first capture command
10. Compose command
11. Basic PDF ingest
12. MCP adapter
13. Validation and fixtures

## Parallel Work Opportunities

- source schema and workspace bootstrap can overlap after project scaffolding
- URL ingest and PDF ingest can proceed independently once normalization rules are fixed
- compose templates can be drafted while capture command work is in progress

## Validation Points

- normalized sources always include complete frontmatter
- bundle manifests reference real source files
- question runs are reproducible and persisted under a stable run directory
- captured answers always link back to question IDs
- outputs preserve traceability to captured answers and source bundles

## Risks

- NotebookLM capture may remain partially manual in MVP
- URL extraction quality may force fallback parsing paths
- question generation quality may vary without stricter schemas
- if capture format is too loose, downstream composition becomes unreliable

## First Milestone

- By the end of milestone 1, SourceLoop should support:
  - workspace bootstrap
  - local file ingest
  - URL ingest
  - topic bundle creation for NotebookLM
  - topic question planning

That milestone is enough to test the real operating model from the post before implementing answer capture and downstream composition.

