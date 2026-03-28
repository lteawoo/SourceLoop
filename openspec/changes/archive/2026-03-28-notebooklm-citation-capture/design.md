## Context

SourceLoop currently archives NotebookLM answers by reading the latest visible response container and saving its raw `innerText()` plus any inline `a[href]` links. In practice, NotebookLM answers mix body text, footnote numbers, icon labels such as `more_horiz`, and citation UI elements inside the same rendered card. The current extraction path therefore produces noisy Markdown answers and usually falls back to a placeholder citation record instead of preserving source traceability.

This change is cross-cutting across the browser runner, selector configuration, exchange archive content, and regression tests. The implementation also needs to remain resilient to minor NotebookLM UI changes without breaking the broader topic-first Q&A workflow.

## Goals / Non-Goals

**Goals:**
- Separate answer-body extraction from citation extraction so archived answers store cleaner Markdown text.
- Expand citation capture beyond inline links to include visible citation UI labels and any extractable source metadata available near the latest NotebookLM answer.
- Preserve the existing run/exchange archive shape while improving the quality of `answer` and `citations` fields.
- Keep a graceful fallback when NotebookLM changes its UI, but reduce the number of runs that end with placeholder-only citation records.

**Non-Goals:**
- Full browser automation of citation drill-down panels beyond what is needed to capture visible metadata.
- Backfilling or migrating already archived exchanges.
- Changing the topic/run/archive workflow or Obsidian note format outside answer-body and citation quality.

## Decisions

### 1. Split extraction into `answer body` and `citation` phases
The browser runner will stop treating the latest response card as a single text blob. Instead, it will identify a stable latest answer container, then run two extractors:
- answer-body extractor: collects visible text blocks from the answer content area only
- citation extractor: scans citation chips, buttons, links, and nearby metadata associated with that answer

This is better than continuing with a single `innerText()` pass because it isolates UI noise and lets citation handling evolve without destabilizing answer capture.

### 2. Prefer visible citation metadata over click-through automation in the first iteration
The first implementation will capture visible citation labels, hrefs when present, and source-path-like text when available. It will not require opening secondary source panels to succeed. This keeps the runner more resilient and reduces the number of brittle UI steps.

The alternative was to click every citation chip and scrape a side panel immediately. That may yield richer metadata, but it is much more fragile and harder to recover from when NotebookLM UI changes.

### 3. Normalize answer text before archive persistence
The answer extractor will normalize whitespace and filter obvious UI-only tokens such as isolated footnote counters or menu labels when they are emitted outside the main prose blocks. The archive contract stays the same, but answer notes become cleaner and more reusable in Obsidian.

The alternative was to post-process archived Markdown after the fact. Doing normalization at extraction time keeps JSON and Markdown aligned and avoids double-cleaning logic later.

### 4. Keep a structured fallback instead of failing runs on missing citations
If answer text is captured but citations cannot be extracted, the runner will still complete and persist a fallback citation note. This preserves run continuity while making it obvious which answers still need manual source review.

The alternative was to fail or mark the entire question incomplete, which would make the workflow too brittle for UI-driven extraction.

## Risks / Trade-offs

- [NotebookLM DOM changes] → Keep selectors configurable and layer multiple selector families for body/citation extraction.
- [Visible citations are still incomplete] → Persist best-effort labels now and leave deeper citation drill-down for a later change if needed.
- [Over-filtering answer text] → Restrict cleanup to obvious UI-only fragments and cover representative answer samples in tests.
- [Selector growth increases maintenance cost] → Centralize selectors in config and test the extraction contract at the browser-agent layer.

## Migration Plan

- No data migration for existing archives.
- New runs will write improved answer/citation content using the existing exchange schema.
- Rollback is low risk because the change is isolated to extraction and archive content quality; reverting restores prior browser-agent behavior.

## Open Questions

- Whether NotebookLM exposes enough visible metadata to reliably capture source titles without clicking citation chips on all answer variants.
- Whether a second-pass citation drill-down change will be needed for richer source snippets after the visible-metadata path lands.
