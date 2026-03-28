## Why

The current NotebookLM run archive captures answer text, but it does not reliably capture NotebookLM citation metadata and it pulls answer text from overly broad containers. This leaves the vault with weak traceability and noisy answer notes that still contain UI artifacts such as citation numbers and control labels.

## What Changes

- Improve NotebookLM browser extraction so answer notes store cleaned answer body text instead of raw container text with UI noise.
- Add structured citation capture for NotebookLM answers, including visible citation labels and any available source metadata that can be extracted from the answer UI.
- Reduce fallback-only citation archives by expanding selector coverage beyond simple inline links.
- Preserve the existing Q&A archive workflow while making answer notes more reusable as research assets inside Obsidian.

## Capabilities

### New Capabilities
- `notebooklm-citation-capture`: Capture NotebookLM citation UI metadata into structured archive fields instead of falling back to placeholder citation notes.
- `notebooklm-answer-normalization`: Extract only the answer body from NotebookLM responses so archived Markdown notes omit UI control text and citation chrome.

### Modified Capabilities
- None.

## Impact

- Affected code: `src/core/notebooklm/browser-agent.ts`, NotebookLM selector config, run/archive rendering, and related tests.
- Affected artifacts: run exchange JSON/Markdown contents, especially `citations` and answer body text quality.
- No external API changes; this is an internal browser-runner and archive quality improvement.
