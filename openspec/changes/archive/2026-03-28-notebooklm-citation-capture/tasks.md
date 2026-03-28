## 1. Answer Extraction Boundaries

- [x] 1.1 Add dedicated NotebookLM selectors for answer-body containers separate from response-card selectors
- [x] 1.2 Refactor the browser runner to extract normalized answer-body text from the latest answer content area instead of raw response `innerText()`
- [x] 1.3 Add cleanup rules for obvious UI-only fragments while preserving best-effort answer text when classification is incomplete

## 2. Citation Capture

- [x] 2.1 Add citation selector coverage for visible reference chips, buttons, and inline links near the latest NotebookLM answer
- [x] 2.2 Extract structured citation entries with visible labels plus optional href or source-path-like metadata when available
- [x] 2.3 Preserve the existing fallback citation record only when no visible citation metadata can be extracted

## 3. Archive Integration

- [x] 3.1 Thread the improved answer text and citation records through the existing exchange JSON archive without changing the schema contract
- [x] 3.2 Ensure exchange Markdown notes render the cleaner answer body and the richer citation list without introducing UI noise back into the note body

## 4. Verification

- [x] 4.1 Add automated coverage for answer normalization using representative noisy NotebookLM response content
- [x] 4.2 Add automated coverage for structured citation capture and fallback-only citation behavior
- [x] 4.3 Validate the complete change with the project test suite and OpenSpec validation
