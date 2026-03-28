# notebook-source-manifests Specification

## Purpose
TBD - created by archiving change topic-source-notebook-contract. Update Purpose after archive.
## Requirements
### Requirement: Operators SHALL be able to declare notebook-backed source manifests
The system SHALL allow operators to record a notebook-backed source bundle as a first-class artifact tied to a topic and a notebook binding.

#### Scenario: Operator declares an existing NotebookLM source bundle
- **WHEN** the operator creates a notebook-source manifest for a topic and bound notebook
- **THEN** the system SHALL persist a durable manifest artifact with the topic id and notebook binding id
- **AND** the manifest SHALL store operator-visible source metadata such as kind, title, and optional references

#### Scenario: Operator targets a missing topic or notebook binding
- **WHEN** the operator tries to declare a notebook-source manifest for a topic or notebook binding that does not exist
- **THEN** the CLI SHALL fail with a clear validation error
- **AND** no partial manifest artifact SHALL be written

### Requirement: Notebook-source manifests SHALL render as Obsidian-friendly notes
The system SHALL render notebook-source manifests as readable vault notes alongside JSON metadata.

#### Scenario: Manifest note is generated
- **WHEN** a notebook-source manifest is created
- **THEN** the Markdown note SHALL include wikilinks back to the topic and notebook binding
- **AND** the note SHALL surface the declared source kind, title, and operator references

### Requirement: Notebook-source manifests SHALL be discoverable from topic artifacts
The system SHALL include notebook-backed source manifests in topic-level corpus visibility.

#### Scenario: Topic corpus includes notebook-backed evidence
- **WHEN** a topic has one or more notebook-source manifests
- **THEN** the topic corpus note SHALL list those manifests alongside local source notes
- **AND** the topic corpus metadata SHALL retain their ids for later preflight and review

