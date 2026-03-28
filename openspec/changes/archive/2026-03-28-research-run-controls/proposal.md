## Why

The core product workflow is now visible and usable, but `plan` and `run` are still too rigid for actual research work. Operators need to control question volume, question families, and partial execution so they can iterate on a topic without regenerating or rerunning everything.

## What Changes

- Add planner controls for question count and question-family selection so one topic can produce shallow or deep batches on demand.
- Add run controls for executing only part of a batch, starting from a later question, or targeting explicit question ids without rewriting artifacts by hand.
- Persist enough run metadata to make partial execution and follow-up execution readable inside the run archive.
- Update operator documentation and tests around the new planning and run-control workflow.

## Capabilities

### New Capabilities
- `research-question-planning-controls`: Control planned question count and family selection for topic-backed research batches.
- `research-run-execution-controls`: Control which planned questions execute during a run, including targeted and bounded execution.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/commands/plan.ts`, `src/core/runs/question-planner.ts`, `src/commands/run.ts`, `src/core/runs/run-qa.ts`, run/question Markdown renderers, and related tests/docs.
- APIs/CLI: new plan and run options, plus richer run metadata in archives.
- Systems: topic-first research workflow, NotebookLM execution loop, Obsidian archive readability.
