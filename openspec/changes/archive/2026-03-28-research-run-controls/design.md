## Context

The current topic-first workflow can create and execute a NotebookLM research run, but the operator has almost no control over scope once planning starts. `plan` always emits the same multi-family batch, and `run` always walks the remaining questions in batch order. In practice, research work needs quick one-question probes, short validation runs, focused execution families, and bounded reruns without hand-editing run artifacts.

## Goals / Non-Goals

**Goals:**
- Add explicit planner controls for maximum question count and family selection.
- Add explicit run controls for targeted execution by question id, bounded execution count, and start-from behavior.
- Keep topic-first run artifacts readable when a run executes only part of its planned batch.
- Preserve the current default behavior when no new options are supplied.

**Non-Goals:**
- Replacing the existing deep-question families or redesigning their prompts.
- Adding thread backfill, replay-from-NotebookLM, or citation-specific behavior.
- Changing the topic / source / notebook binding model.

## Decisions

### 1. Planner control stays at batch-creation time
`plan` will accept explicit knobs such as `--max-questions` and `--families`. These values will shape the generated `QuestionBatch` once, and the resulting batch will record that planning scope in metadata. This keeps planning deterministic and preserves a readable archive contract.

Alternative considered:
- Applying ad hoc filtering only at `run` time. Rejected because it hides the actual planned scope from the stored batch and makes later review harder.

### 2. Run selection operates on planned question ids
`run` will accept a small set of selectors such as explicit `--question-id`, `--from-question`, and `--limit`. The runner will resolve these against the stored batch order, skip already-completed questions unless they are explicitly targeted in a supported way, and archive what was actually executed.

Alternative considered:
- Creating a second “execution plan” artifact. Rejected for now because it adds another layer of artifacts before there is evidence we need it.

### 3. Partial execution must be visible in the archive
Run metadata and run notes will show execution bounds and selected question ids when a run is not executing the whole batch. This keeps the Obsidian archive understandable without opening JSON first.

Alternative considered:
- Leaving partial execution implicit in `completedQuestionIds`. Rejected because operators need to know whether a run is intentionally partial or merely incomplete.

## Risks / Trade-offs

- **[Risk] Planner options can make generated batches too narrow to be useful** → Mitigation: keep defaults unchanged and persist planning metadata for review.
- **[Risk] Run selectors can conflict with already completed questions** → Mitigation: define deterministic behavior and surface clear CLI errors for unsupported overwrite/replay cases.
- **[Risk] More CLI options can make the workflow harder to learn** → Mitigation: keep the option set small and document the recommended paths with examples.

## Migration Plan

1. Extend question batch and run index metadata to store planning and execution controls compatibly.
2. Add planner option parsing and filtered question generation.
3. Add run option parsing and selected-question execution logic.
4. Update Markdown renderers and docs.
5. Validate existing default flows still behave the same when no new options are used.

## Open Questions

- Whether `run --question-id` should allow overwriting an already completed question in this phase, or stay read-only and require a future explicit replay command.
- Whether family names should be user-facing exactly as stored internally, or normalized to a friendlier alias set first.
