## Context

The current topic-first workflow assumes that a topic corpus is backed by local `SourceDocument` artifacts. That assumption works for file/url ingestion, but it fails the common SourceLoop case where the operator already loaded the real material into NotebookLM before using the CLI. To get past current corpus checks, the operator creates a placeholder Markdown note; this keeps the code moving but does not actually model the source-of-truth research basis.

This change needs to tighten the contract between:
- `Topic`
- the topic corpus manifest
- the bound NotebookLM notebook
- the real source basis already living inside NotebookLM

The design must preserve the existing archive/run behavior while removing the fake-anchor requirement. It also must stay honest about what SourceLoop can and cannot verify automatically: we can record operator-declared notebook source bundles, but we are not yet building full NotebookLM source introspection.

## Goals / Non-Goals

**Goals:**
- Introduce a first-class artifact for notebook-backed source manifests
- Allow topic corpus readiness to be satisfied by either local sources or notebook-backed source manifests
- Keep topic status and run preflight aligned with that broader corpus definition
- Make notebook-backed source declarations visible in Obsidian-friendly topic/corpus notes
- Preserve current local source ingestion and run/archive flows

**Non-Goals:**
- Automatically scraping the full NotebookLM source list from the UI in this change
- Replacing local source ingestion with notebook-only workflows
- Building a multi-notebook synchronization engine
- Changing question planning or run execution semantics beyond corpus readiness/preflight

## Decisions

### 1. Introduce a dedicated `NotebookSourceManifest` artifact

We will add a new durable artifact that represents an operator-declared source bundle already loaded into NotebookLM. Each manifest belongs to exactly one topic and references exactly one notebook binding. It stores lightweight, human-authored metadata such as:
- manifest id
- topic id
- notebook binding id
- source kind (`youtube-playlist`, `youtube-channel`, `document-set`, `web-collection`, `mixed`, etc.)
- short title/description
- optional item count
- optional external references (playlist URL, creator URL, search URL, notes)

This is intentionally a declaration artifact, not a verified mirror of NotebookLM internals.

Alternatives considered:
- Extend `NotebookBinding` itself with freeform source notes: rejected because bindings and source evidence are different concepts with different update cadence.
- Continue using fake local Markdown sources: rejected because it pollutes the corpus model and hides where the real source basis lives.

### 2. Treat topic corpus as a union of local sources and notebook-backed source manifests

Today the corpus manifest only tracks local `sourceIds`, `notebookBindingIds`, and `runIds`. We will extend the corpus model so that it can also track `notebookSourceManifestIds`. Topic readiness and preflight checks will consider a topic corpus valid if it has:
- at least one notebook binding
- and at least one evidence source, where evidence can be either:
  - local source notes
  - notebook-source manifests

Alternatives considered:
- Require both local sources and notebook manifests: rejected because it preserves unnecessary duplication.
- Allow notebook binding alone to imply evidence: rejected because it is too weak; the notebook still needs an explicit declaration of what source bundle it represents.

### 3. Add an explicit operator command for notebook-source declaration

The cleanest workflow is a dedicated CLI entrypoint, for example:

```bash
sourceloop notebook-source declare \
  --topic-id topic-ai-agents-market \
  --notebook notebook-ai-agents \
  --kind youtube-playlist \
  --title "AI agents market source set" \
  --ref "https://youtube.com/playlist?list=..."
```

This keeps source declaration intentional and avoids overloading `notebook-bind` with too many orthogonal responsibilities.

Alternatives considered:
- Implicitly create a notebook-source manifest during `notebook-bind`: rejected because the operator may not yet know the right source-bundle description at bind time.
- Hang the command under `topic`: rejected because the manifest is notebook-backed evidence, not a generic topic field.

### 4. Keep preflight conservative but notebook-aware

Run planning and execution checks will remain conservative. The system will not assume that a notebook binding is sufficient by itself. Instead, it will accept one of two evidence paths:
- local source ingestion exists for the topic
- notebook-source manifest exists for the bound notebook/topic pair

This preserves the “no fake basis” rule while letting real NotebookLM-backed workflows move forward.

Alternatives considered:
- Remove all source preflight requirements: rejected because it makes topic/corpus quality regress back to notebook-only guesswork.

## Risks / Trade-offs

- [Operator-declared notebook manifests can drift from real NotebookLM contents] → Keep the manifests lightweight, explicit, and visible in topic/corpus notes so drift is reviewable.
- [New command adds workflow surface area] → Make declaration optional only when local sources already exist; otherwise document it as the preferred path for notebook-preloaded topics.
- [Corpus logic becomes more complex] → Keep readiness rules simple: any evidence source + at least one binding.
- [Future automatic NotebookLM introspection may want a different model] → Use a neutral manifest schema that can later be populated automatically instead of replaced.

## Migration Plan

1. Add `NotebookSourceManifest` schema, vault paths, and note rendering
2. Extend topic corpus manifests to track notebook-source manifest ids
3. Add CLI creation/list/show flow for notebook-source manifests
4. Update topic refresh logic, topic status, and run preflight to accept notebook-backed evidence
5. Update docs and test plans to remove the fake local anchor note from the preferred flow

Rollback strategy:
- Keep existing local source ingestion unchanged
- If notebook-source manifests prove confusing, operators can still use local sources as before
- No existing run/archive files need migration for readability; new corpus fields can default empty

## Open Questions

- Should the first command support multiple `--ref` entries, or should follow-up edits handle that later?
- Should notebook-source manifests be editable in place, or is replace-with-`--force` enough for the first version?
- Do we want a dedicated `topic inspect` view that distinguishes local evidence from notebook-backed evidence more explicitly?
