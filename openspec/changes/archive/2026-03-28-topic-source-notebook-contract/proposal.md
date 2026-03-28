## Why

SourceLoop now models topics, planning, and bounded execution well, but it still treats the topic corpus too narrowly. In real use, the operator often already has the true research sources loaded into NotebookLM, yet SourceLoop still asks for a local source note just to satisfy corpus preconditions; that contract is artificial and weakens the topic-first workflow.

## What Changes

- Introduce a durable notebook-source manifest artifact that records operator-declared source bundles already loaded into a bound NotebookLM notebook.
- Allow a topic corpus to treat local source notes and notebook-source manifests as equivalent evidence that the topic has real backing material.
- Update topic status, corpus rendering, and preflight checks so planning and runs can proceed when a topic is backed by notebook-source manifests even if no local Markdown sources were ingested.
- Add CLI support to declare and inspect notebook-backed source manifests without forcing fake local anchor notes.
- Clarify docs so the preferred workflow becomes: choose topic, bind notebook, declare notebook sources if they already exist, plan, run, archive.

## Capabilities

### New Capabilities
- `notebook-source-manifests`: Record NotebookLM-backed source bundles as first-class topic artifacts.
- `topic-corpus-evidence-contract`: Define topic corpus readiness in terms of either local sources or notebook-source manifests.

### Modified Capabilities
- None.

## Impact

- Affects topic/corpus domain models, notebook binding workflows, run preflight rules, and vault artifacts.
- Adds a new operator-visible step for declaring existing NotebookLM source bundles.
- Removes the need for fake local manifest notes in the preferred topic-first workflow.
