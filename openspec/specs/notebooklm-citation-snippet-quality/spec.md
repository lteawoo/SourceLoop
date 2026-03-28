# notebooklm-citation-snippet-quality Specification

## Purpose
TBD - created by archiving change complete-notebooklm-citation-collection. Update Purpose after archive.
## Requirements
### Requirement: Citation snippets SHALL prefer readable source evidence over clipped UI residue
The system SHALL normalize collected NotebookLM citation notes so archived citations preserve a readable source title and excerpt instead of obvious clipped-leading fragments or duplicated UI residue.

#### Scenario: Hover snippet begins mid-word
- **WHEN** a collected citation snippet begins with an obvious clipped-leading fragment such as a truncated token from the middle of a word
- **THEN** the archived citation note SHALL trim that fragment before rendering the snippet
- **AND** the remaining note SHALL still preserve the readable source evidence for human review

#### Scenario: Source title is duplicated inside the citation note
- **WHEN** the same source title appears both as the structured title and again inside the collected snippet tail
- **THEN** the archived citation note SHALL render the source title once
- **AND** the remaining snippet SHALL keep only the surviving source excerpt

### Requirement: Citation notes SHALL remain concise inside exchange archives
The system SHALL preserve one readable citation note per label that is concise enough for exchange Markdown review without discarding the fact that a citation exists.

#### Scenario: A collected citation excerpt is extremely long
- **WHEN** a hover-derived citation snippet exceeds the archive readability threshold
- **THEN** the system SHALL truncate the note to a bounded readable excerpt
- **AND** the resulting citation entry SHALL still identify the source label and title

### Requirement: Improved snippet normalization SHALL preserve existing inline anchor workflows
The system SHALL continue rendering answer-body inline anchors and citation-section block targets even when citation notes are normalized more aggressively.

#### Scenario: Answer body references a normalized citation
- **WHEN** an exchange note renders inline citation anchors such as `[1]`
- **THEN** those anchors SHALL still point to the matching citation entry for label `1`
- **AND** snippet cleanup SHALL not change the citation label used by the answer-body anchor

