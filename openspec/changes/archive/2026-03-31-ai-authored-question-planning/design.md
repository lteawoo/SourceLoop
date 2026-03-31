## Context

SourceLoop already has a stable planning and execution loop, but the current planner still assumes that SourceLoop itself authors the question batch from a built-in generic template. That is too rigid for the intended workflow, where an external AI assistant interprets the user’s topic, goal, and intended output, then produces a stronger topic-specific research batch that SourceLoop can run against NotebookLM.

The change needs to fit three constraints:
- SourceLoop must stay model-agnostic and avoid coupling planning to a single provider SDK
- the run/archive contract must stay stable so execution and downstream composition keep working
- existing planning controls such as `maxQuestions` and `families` must still behave predictably

## Goals / Non-Goals

**Goals:**
- Add a provider-agnostic way to pass AI-authored question drafts into `plan`
- Validate imported question drafts before creating any run or batch artifacts
- Reuse the existing planning pipeline so AI-authored batches and template-authored batches produce the same run/archive shape
- Preserve `families` and `maxQuestions` as post-generation planning controls
- Keep the built-in template planner as the fallback path when no AI-authored batch is supplied

**Non-Goals:**
- Embedding a direct OpenAI, Anthropic, or Gemini API client inside SourceLoop
- Guaranteeing semantic quality, novelty, or domain correctness of every imported AI-authored question
- Replacing the existing built-in planner in this change
- Designing a prompt authoring UX or prompt registry for every agent environment

## Decisions

### 1. Accept AI-authored questions through a file-based contract

`plan` will accept a `--questions-file` argument that points to a local JSON file. The file is the contract boundary between external AI question generation and SourceLoop planning.

Rationale:
- keeps SourceLoop independent from a specific LLM provider or SDK
- works with Codex, Claude Code, Gemini CLI, or any other agent that can write JSON
- keeps the planning path inspectable and easy to debug

Alternatives considered:
- Direct provider integrations inside SourceLoop: rejected because it would hard-code one orchestration path and add credential/runtime complexity.
- Shelling out to an agent from `plan`: rejected because planning should stay deterministic once the batch is handed to SourceLoop.

### 2. Normalize imported drafts into the existing planned-question archive contract

SourceLoop will validate imported drafts against a lightweight draft schema, then convert them into the existing planned-question structure by assigning SourceLoop IDs and batch order.

Rationale:
- avoids branching the run executor or archive writer
- preserves downstream compatibility for `run`, `compose`, and note rendering

Alternatives considered:
- Store imported questions as a separate artifact type: rejected because it would fork the execution path for no clear runtime gain.

### 3. Apply planning scope after draft validation

Imported drafts will first be validated structurally, then filtered by supported families, then truncated by `maxQuestions`.

Rationale:
- keeps scope controls source-agnostic
- lets operators generate a rich question pool externally and still use SourceLoop to trim it for cost or focus

Alternatives considered:
- Require the external AI to pre-apply every limit: rejected because it weakens SourceLoop’s role as the final planning authority.
- Ignore planning controls for imported batches: rejected because it would create two incompatible planning modes.

### 4. Fail closed when imported drafts are unusable

If the question file is malformed, contains unsupported families, or becomes empty after scope filtering, `plan` must fail before writing batch artifacts.

Rationale:
- prevents partial or misleading archive state
- makes automation failures visible immediately

Alternatives considered:
- Silently falling back to the template planner: rejected because it hides orchestration failures and can produce a batch the operator did not ask for.

### 5. Keep operator documentation aligned with the preferred workflow

Operator playbooks and generated bootstrap guidance should explicitly prefer AI-authored topic-specific question batches when the operator can generate them, while documenting the template planner as fallback.

Rationale:
- keeps the documented workflow aligned with the intended product behavior
- reduces the gap between agent usage and CLI capability

## Risks / Trade-offs

- [File handoff adds an extra step] → Keep the contract simple JSON and document it in operator guidance.
- [AI-authored question quality remains variable] → Validate structure in SourceLoop and keep the external AI responsible for semantic quality.
- [Scope filtering can remove all imported questions] → Fail with a clear error before writing any plan artifacts.
- [Two planning sources can confuse operators] → Document AI-authored questions as the preferred path and the built-in planner as explicit fallback.

## Migration Plan

1. Add the draft-question schema and `--questions-file` planning path.
2. Route validated imported drafts into the existing planning archive pipeline.
3. Preserve existing template planning behavior when no question file is supplied.
4. Update README, playbooks, and generated operator bootstrap text to describe the preferred AI-authored path.

Rollback strategy:
- remove the `--questions-file` option
- revert planning to the built-in template-only flow without affecting run execution artifacts

## Open Questions

- Should SourceLoop eventually persist a `generationMode` or `questionSource` field in run metadata for auditability?
- Should SourceLoop publish a JSON schema or example artifact that agent bootstraps can reference directly?
- Should future iterations add semantic linting for duplicate, vague, or weak imported questions before planning succeeds?
