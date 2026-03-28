# notebooklm-citation-capture Specification

## Purpose
TBD - created by archiving change notebooklm-citation-capture. Update Purpose after archive.
## Requirements
### Requirement: NotebookLM citations SHALL be archived from visible answer references
The system SHALL capture citation metadata from the visible reference UI associated with the latest NotebookLM answer instead of relying only on inline hyperlinks.

#### Scenario: Citation labels are visible in the answer UI
- **WHEN** a NotebookLM answer displays citation chips, numbered references, or source reference controls near the answer
- **THEN** the archived exchange SHALL include structured citation entries for those visible references

#### Scenario: Citation references expose href metadata
- **WHEN** a visible citation reference includes a hyperlink target
- **THEN** the archived citation entry SHALL preserve that href alongside its label

### Requirement: Citation capture SHALL degrade gracefully when metadata is incomplete
The system SHALL preserve a best-effort citation record even when NotebookLM does not expose full source metadata in visible UI.

#### Scenario: Citation UI is partially visible
- **WHEN** the runner can read a citation label but cannot resolve a full href or source path
- **THEN** the archived citation entry SHALL still include the visible label and any other extracted metadata without failing the question

#### Scenario: No citation metadata is extractable
- **WHEN** the answer body is captured but no visible citation metadata can be extracted
- **THEN** the archived exchange SHALL contain an explicit fallback citation note indicating that NotebookLM citation UI was not captured

