## Context

SourceLoop already captures visible NotebookLM citation markers and hover snippets, but the current browser runner still stops at whatever citation UI is immediately visible inside the answer surface. In practice, NotebookLM can collapse additional citations behind `...` or similar overflow controls, and the resulting hover snippets often begin mid-word because the visible popover text is clipped transcript content rather than a clean source excerpt.

This change touches the NotebookLM browser session, selector configuration, citation extraction helpers, and exchange archive rendering. It must improve citation completeness without making answer completion detection brittle again, and it must preserve the existing answer-first archive contract so topic/run/exchange workflows do not change.

## Goals / Non-Goals

**Goals:**
- Reveal hidden NotebookLM citation UI before snapshotting the latest answer so archived citations better match what a human can inspect in the live notebook.
- Keep citation extraction resilient by separating overflow-reveal interactions from answer stability polling.
- Improve citation snippet readability by trimming obvious clipped-leading fragments and preserving the strongest source excerpt per citation label.
- Preserve existing exchange JSON/Markdown shapes while increasing citation completeness and quality.

**Non-Goals:**
- Full source-panel crawling or deep source export beyond what NotebookLM exposes in inline dialogs and visible citation UI.
- Migration of old exchanges that were already archived with incomplete citations.
- Reworking the topic/run/archive workflow outside citation completeness and snippet quality.

## Decisions

### 1. Reveal overflow citations only after the latest answer is stable
The runner will keep answer stability detection lightweight, then run a second interaction phase that expands visible overflow controls related to the latest answer before collecting citation candidates and popovers.

This is better than expanding UI during streaming because the previous timeout issue showed that heavy DOM interaction inside the stability loop makes runs fragile. The alternative was to expand overflow eagerly on every polling pass, but that would reintroduce instability and slow the hot path.

### 2. Treat overflow expansion as best-effort, not a run blocker
If SourceLoop can identify and click a `...`-style control, it will collect newly revealed markers and merge them into the same citation set. If the control is absent, hidden, or changes in a future NotebookLM revision, the runner will still archive the answer with whatever visible citations were captured.

This is better than failing a run when overflow cannot be opened because citation completeness is important, but the workflow should remain answer-first. The alternative was to mark the question incomplete whenever expansion fails, which would make the browser runner too sensitive to UI drift.

### 3. Normalize snippet quality at merge time, not by mutating raw browser snapshots
The extractor will keep raw candidate fields (`ariaLabel`, `popoverText`, selector hints) intact long enough to merge and compare duplicate labels. Readability cleanup will happen in the normalization step so the best surviving citation note is concise, de-duplicated, and less likely to start mid-word.

This is better than trimming inside the browser snapshot because merge quality depends on seeing the richer raw candidate first. The alternative was to clean each popover before dedupe, but that throws away information that can help choose the best note.

### 4. Prefer one merged citation per label with the richest surviving excerpt
When overflow reveal produces the same label through multiple UI paths, SourceLoop will continue to dedupe by label, preserving a single citation entry that keeps the strongest available title/path/href and the best readable snippet.

This is better than preserving every candidate because duplicated labels make the Markdown archive noisy and undermine the point of inline anchors. The alternative was to keep all collected candidates for forensic completeness, but that is better suited to debug logging than the user-facing exchange archive.

## Risks / Trade-offs

- [Overflow selectors vary across NotebookLM revisions] → Keep selectors layered and best-effort; do not make expansion mandatory for successful runs.
- [Extra clicks could perturb the page] → Run overflow expansion only after answer stability and scope it to controls near the latest answer container.
- [Snippet cleanup may over-trim real content] → Restrict cleanup to obvious clipped-leading fragments and cover representative transcript cases in tests.
- [Long citation collection time on answers with many references] → Expand overflow once per answer and keep per-label merge logic cheap so the slower work stays bounded.

## Migration Plan

- No data migration is required.
- New runs and `import-latest` captures will archive more complete citations and cleaner citation notes.
- Rollback is low risk: reverting restores the current visible-only citation capture path without changing stored schema contracts.

## Open Questions

- Whether NotebookLM exposes multiple nested overflow controls on especially dense answers, or whether a single reveal pass is enough in practice.
- Whether future work should persist raw debug-only citation metadata separately for troubleshooting when readable snippet cleanup is still imperfect.
