# notebooklm-answer-normalization Specification

## Purpose
TBD - created by archiving change notebooklm-citation-capture. Update Purpose after archive.
## Requirements
### Requirement: NotebookLM answer archives SHALL store normalized answer-body text
The system SHALL archive only the answer body text for the latest NotebookLM response instead of persisting raw response-container text with surrounding UI chrome.

#### Scenario: Response card includes body text and UI controls
- **WHEN** the latest NotebookLM response contains prose plus visible UI elements such as menu labels, chip text, or citation chrome
- **THEN** the archived `answer` field SHALL store the normalized answer body without those UI-only fragments

#### Scenario: Answer body spans multiple visible text blocks
- **WHEN** the latest NotebookLM answer is rendered across multiple visible text containers
- **THEN** the archive SHALL combine those text blocks into a single normalized answer body in reading order

### Requirement: Answer normalization SHALL preserve successful runs when cleanup is best-effort
The system SHALL not fail a NotebookLM question solely because answer cleanup could not perfectly classify every visible token.

#### Scenario: Some noisy fragments remain ambiguous
- **WHEN** the extractor cannot confidently classify every visible fragment as body text or UI noise
- **THEN** it SHALL preserve the best-effort normalized answer body and continue archiving the exchange

