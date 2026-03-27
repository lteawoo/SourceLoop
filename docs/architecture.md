# SourceLoop Architecture

## Architecture Summary

- Problem: formalize the exact research workflow from the X post into a repeatable system for Codex and Claude Code.
- Core direction: `SourceLoop` is not a NotebookLM replacement. It is a local-first orchestration pipeline around NotebookLM.
- Primary outcome: package sources for NotebookLM, generate stronger question sets, capture NotebookLM answers back to disk, and turn them into reusable research assets.

## Core Thesis

The workflow from the post can be reduced to four stages:

1. Source Packaging
2. Question Orchestration
3. NotebookLM Answer Capture
4. Human Expression

`SourceLoop` should productize those stages, not attempt to replace NotebookLM’s source-grounded answering.

## MVP Scope

- accept source material from URLs, local markdown/text files, and PDFs
- normalize all inputs into canonical Markdown with metadata
- group normalized sources into topic bundles for NotebookLM upload
- generate topic-specific question trees for research sessions
- store question runs locally
- capture NotebookLM answers, citations, and operator notes into local files
- compose downstream artifacts such as briefing docs and outlines from captured answers

Out of scope for MVP:

- replacing NotebookLM retrieval or answer generation
- browser automation for every data source
- direct video/audio understanding beyond transcript ingestion
- multi-user collaboration
- cloud sync or hosted workspace management

## System Boundaries

### SourceLoop Responsibilities

- convert raw source material into NotebookLM-ready text assets
- maintain consistent local storage for sources, runs, answers, and outputs
- generate research question sets from topics
- provide structured capture templates for NotebookLM responses
- transform captured answers into reusable deliverables
- expose the workflow through CLI first, then MCP tools

### NotebookLM Responsibilities

- host topic-specific knowledge bases
- answer questions based on uploaded material
- provide source-linked answer grounding for operator review

### Agent Responsibilities

- use Codex or Claude Code to execute the pipeline steps
- refine topics and question strategies
- help the operator process captured answers into deliverables

### Human Responsibilities

- decide what source material is worth feeding
- verify answer quality and source fidelity in NotebookLM
- add interpretation, framing, and communication style
- produce the final expressive layer rather than delegating it entirely to AI

## Major Components

### Entry Points

- `sourceloop init`
- `sourceloop ingest`
- `sourceloop notebook-pack`
- `sourceloop plan`
- `sourceloop capture`
- `sourceloop compose`

### Pipeline Modules

#### 1. Source Packaging

- `ingest`: fetch and parse URLs, PDFs, and local files
- `normalize`: convert everything into canonical Markdown plus frontmatter
- `bundle`: create topic-specific NotebookLM upload bundles

#### 2. Question Orchestration

- `plan`: generate research question trees for a topic
- `runs`: persist question plans and run metadata
- `templates`: produce capture-friendly question sheets

#### 3. NotebookLM Answer Capture

- `capture`: record NotebookLM answers back into local files
- `citations`: store source references and operator notes
- `archive`: preserve captured Q&A for reuse in later work

#### 4. Human Expression

- `compose`: turn captured Q&A into briefings, outlines, scripts, or drafts
- `handoff`: keep clear links from outputs back to the underlying captured evidence

### Infrastructure

- workspace resolver
- config loader
- schema validation
- logger
- optional model adapters for question generation and composition

## Data and Interfaces

### Primary Entities

#### SourceDocument

- `id`
- `type`: `url | pdf | file | transcript`
- `source_uri`
- `title`
- `author`
- `captured_at`
- `topic_tags`
- `language`

#### NotebookBundle

- `id`
- `topic_slug`
- `source_ids`
- `bundle_path`
- `manifest_path`
- `created_at`

#### ResearchRun

- `id`
- `topic`
- `bundle_id`
- `objective`
- `question_count`
- `created_at`

#### QuestionNode

- `id`
- `run_id`
- `parent_id`
- `question`
- `kind`: `core | deep_dive | comparison | execution`
- `priority`

#### CapturedAnswer

- `id`
- `run_id`
- `question_id`
- `answer_path`
- `citation_refs`
- `operator_note`
- `captured_at`

#### OutputArtifact

- `id`
- `run_id`
- `kind`: `brief | outline | script | post_draft`
- `path`
- `created_at`

### File Layout

```text
SourceLoop/
  vault/
    sources/
    bundles/
    runs/
      <run-id>/
        questions.md
        questions.json
        answers/
        citations.json
    outputs/
```

### Canonical Source Format

Each normalized source should be a Markdown file with frontmatter:

```md
---
id: src_001
type: url
source_uri: https://example.com/post
title: Example Post
captured_at: 2026-03-27T00:00:00Z
topic_tags:
  - notebooklm
  - research
---
```

### Bundle Manifest Format

```json
{
  "id": "bundle_ai-agent-market",
  "topic_slug": "ai-agent-market",
  "created_at": "2026-03-27T00:00:00Z",
  "sources": [
    {
      "source_id": "src_001",
      "title": "Example Post",
      "markdown_path": "vault/sources/src_001.md"
    }
  ]
}
```

### CLI Interface Shape

```bash
sourceloop init
sourceloop ingest <uri-or-path>
sourceloop notebook-pack <topic>
sourceloop plan <topic>
sourceloop capture <run-id>
sourceloop compose <run-id> --format brief
```

## Data Flow

1. Raw source material enters through `ingest`.
2. SourceLoop writes a canonical Markdown version into the local vault.
3. `notebook-pack` gathers relevant sources into a topic bundle and writes a manifest for NotebookLM upload.
4. The operator uploads the bundle contents into a NotebookLM notebook.
5. `plan` generates a structured question tree for that topic and stores the run locally.
6. The operator or agent asks those questions in NotebookLM.
7. `capture` stores answers, citations, and notes back into the local workspace.
8. `compose` turns captured Q&A into downstream research artifacts.
9. Final expression is reviewed and reshaped by a human.

## Proposed Structure

```text
SourceLoop/
  README.md
  docs/
    architecture.md
    tasks.md
  src/
    cli/
    commands/
    core/
      ingest/
      normalize/
      bundle/
      plan/
      capture/
      compose/
    adapters/
      notebooklm/
      models/
      fetchers/
    schemas/
    lib/
  vault/
    sources/
    bundles/
    runs/
    outputs/
  tests/
```

## Recommended Initial Stack

- runtime: Node.js
- language: TypeScript
- CLI parser: `commander` or `cac`
- validation: `zod`
- markdown utilities: `remark` family or lightweight parser helpers
- PDF parsing: minimal extraction library
- tests: `vitest`

The stack stays simple because the product value is in workflow discipline, not infrastructure complexity.

## Risks and Decisions Needed

### Technical Risks

- URL and PDF extraction quality may vary
- NotebookLM may not expose reliable automation interfaces, so capture may need a manual-first flow
- citation quality depends on how faithfully answers and source refs are recorded
- over-automating the expression step would conflict with the original workflow thesis

### Decisions Still Needed

- whether `capture` should start as manual template filling or browser-assisted parsing
- whether `plan` uses a model provider immediately or starts from deterministic templates
- how strict the citation format should be for captured answers
- whether bundles should be topic-curated manually or auto-suggested by tags

### Pre-Implementation Checks

- define the first supported NotebookLM upload workflow
- define the exact answer capture template
- confirm what a “good enough” citation record looks like in the workspace

## Next Steps

- scaffold the TypeScript CLI project
- implement `init` and workspace layout
- implement `ingest` for local files and URLs
- implement `notebook-pack` and bundle manifests
- implement `plan` for question tree generation
- implement a manual-first `capture` flow
- implement `compose` from captured Q&A

