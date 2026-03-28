## Why

SourceLoop can now capture visible NotebookLM citations, but it still misses citations hidden behind overflow UI and preserves hover snippets with broken leading fragments. This leaves runs with incomplete traceability and noisy citation notes even when NotebookLM is already showing the missing source evidence on screen.

## What Changes

- Expand NotebookLM citation collection so the runner can reveal and capture citations hidden behind `...` or similar overflow controls before archiving an answer.
- Improve citation snippet normalization so archived citation notes remove obvious clipped-leading fragments and keep the most useful source excerpt for human review.
- Preserve the current answer-first Q&A archive workflow while making citation coverage closer to what a human sees in the live NotebookLM UI.

## Capabilities

### New Capabilities
- `notebooklm-citation-overflow`: Reveal and collect NotebookLM citations that are present in collapsed or overflow citation UI, not just markers that are already visible inline.
- `notebooklm-citation-snippet-quality`: Normalize extracted citation snippets so archived notes keep readable source evidence instead of clipped transcript fragments or duplicated UI residue.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/core/notebooklm/browser-agent.ts`, NotebookLM selector config, citation extraction helpers, and run exchange rendering/tests.
- Affected artifacts: exchange JSON/Markdown citation completeness and citation note readability.
- No external API changes; this is an internal NotebookLM browser-runner quality improvement.
