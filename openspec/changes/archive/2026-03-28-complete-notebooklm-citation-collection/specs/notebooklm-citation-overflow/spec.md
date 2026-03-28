## ADDED Requirements

### Requirement: Hidden NotebookLM citation markers SHALL be collected when overflow UI is present
The system SHALL expand answer-local NotebookLM citation overflow controls, when they are visible and actionable, before collecting citation markers for the latest archived answer.

#### Scenario: Overflow citations are revealed before archive capture
- **WHEN** the latest NotebookLM answer contains a visible overflow control that hides additional citation markers
- **THEN** the runner opens that control before the citation snapshot is finalized
- **AND** newly revealed citation markers are included in the archived citation set

#### Scenario: No visible overflow control exists
- **WHEN** the latest NotebookLM answer exposes all currently available citations without a collapsed overflow control
- **THEN** the runner SHALL continue citation capture without error
- **AND** the archived answer SHALL still be persisted from the visible citation UI

### Requirement: Overflow reveal SHALL be best-effort and non-blocking
The system MUST NOT fail a question run solely because a NotebookLM citation overflow control is absent, stale, or cannot be opened.

#### Scenario: Overflow expansion fails
- **WHEN** the runner cannot interact with a candidate overflow control near the latest answer
- **THEN** the answer archive SHALL still complete using the citation markers that remain visible
- **AND** the question SHALL not be marked failed only because overflow reveal was incomplete

### Requirement: Duplicate citation labels from multiple UI paths SHALL be merged
The system SHALL merge citations that resolve to the same visible NotebookLM label even when they are discovered through both inline markers and overflow-revealed UI.

#### Scenario: The same citation label appears inline and after overflow reveal
- **WHEN** multiple citation candidates share the same label for a single answer
- **THEN** the archive SHALL contain one merged citation entry for that label
- **AND** the merged entry SHALL preserve the richest available metadata from the collected candidates
