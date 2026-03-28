## 1. Overflow Citation Reveal

- [x] 1.1 Add NotebookLM selectors and runner helpers for answer-local citation overflow controls such as `...` or similar expandable UI
- [x] 1.2 Expand visible overflow controls only after the latest answer is stable and before citation candidates are collected
- [x] 1.3 Merge overflow-revealed citation markers into the same deduped citation set without failing the run when expansion is unavailable

## 2. Citation Snippet Quality

- [x] 2.1 Refine citation note normalization to trim obvious clipped-leading fragments from hover snippets
- [x] 2.2 Remove duplicated source-title residue and keep the best surviving excerpt per citation label
- [x] 2.3 Preserve inline answer anchors and citation block targets while improving citation note readability

## 3. Verification

- [x] 3.1 Add automated coverage for overflow reveal behavior and best-effort fallback when no expandable citation UI exists
- [x] 3.2 Add automated coverage for clipped-leading snippet cleanup and merged citation-note selection
- [x] 3.3 Validate the complete change with the project test suite and OpenSpec validation
