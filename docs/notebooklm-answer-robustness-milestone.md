# NotebookLM Answer Robustness Milestone

## Goal

Prevent SourceLoop from treating NotebookLM loading or transition text as completed answers, and reduce answer-capture stalls during run execution.

## Milestones

### M1. Placeholder detection

- Detect transient NotebookLM loading phrases such as `Getting the context...`, `Getting the gist...`, `Scanning the text...`, `Expanding the Definition...`, and similar short progress text.
- Reject these placeholders in both live run capture and `import-latest`.
- Completion criteria:
  - placeholder text is not accepted as a valid answer body
  - tests cover the known failure strings observed in the harness engineering run

### M2. Stronger latest-answer readiness

- Tighten the latest-answer readiness checks so `captureLatestAnswer()` waits for a non-placeholder, materially sized response.
- Keep the guard small and deterministic enough for unit tests.
- Completion criteria:
  - `import-latest` no longer stores loading text as a finished answer
  - tests cover the readiness predicate directly

### M3. Run failure visibility

- Ensure that when answer capture fails, the run stops with a useful failure reason instead of silently encouraging a misleading completed state.
- Completion criteria:
  - failure mode is observable from run state or thrown error
  - tests cover the rejection path in run/import logic

## Non-goals

- No broad NotebookLM DOM refactor in this pass
- No new browser automation framework
- No attempt to redesign citation expansion logic beyond what is required for reliability guards

## Verification

- Targeted unit tests:
  - `tests/notebooklm-browser-agent.test.ts`
  - `tests/notebook-runner.test.ts`
- Focused execution:
  - `pnpm test -- notebooklm-browser-agent.test.ts notebook-runner.test.ts`
