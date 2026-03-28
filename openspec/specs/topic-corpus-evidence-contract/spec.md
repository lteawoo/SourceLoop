# topic-corpus-evidence-contract Specification

## Purpose
TBD - created by archiving change topic-source-notebook-contract. Update Purpose after archive.
## Requirements
### Requirement: Topic corpus readiness SHALL accept notebook-backed evidence
The system SHALL treat notebook-source manifests as valid topic evidence alongside local source notes.

#### Scenario: Topic has notebook-backed evidence but no local source note
- **WHEN** a topic has at least one notebook binding and at least one notebook-source manifest
- **THEN** the topic SHALL be considered ready for planning even if no local source document exists

#### Scenario: Topic has no evidence artifacts
- **WHEN** a topic has notebook bindings but neither local sources nor notebook-source manifests
- **THEN** the topic SHALL remain in a source-collection state
- **AND** planning or execution preflight SHALL explain that the topic still lacks declared evidence

### Requirement: Run preflight SHALL accept notebook-backed topic evidence
The system SHALL allow a run to proceed when its topic corpus is backed by notebook-source manifests.

#### Scenario: Topic-backed run uses notebook-backed evidence
- **WHEN** a planned run references a topic whose corpus contains notebook-source manifests aligned to its bound notebook
- **THEN** run preflight SHALL permit execution without requiring a fake local source note

#### Scenario: Notebook binding exists without declared evidence
- **WHEN** a run references a topic with a notebook binding but no local sources and no notebook-source manifests
- **THEN** run preflight SHALL fail with a clear corpus-evidence error
- **AND** the error SHALL direct the operator to add either a local source or a notebook-source manifest

### Requirement: Topic and corpus notes SHALL distinguish evidence types
The system SHALL render local-source evidence and notebook-backed evidence as separate, readable groups.

#### Scenario: Topic mixes local and notebook-backed evidence
- **WHEN** a topic corpus contains both local source notes and notebook-source manifests
- **THEN** the topic corpus note SHALL show both groups distinctly
- **AND** the topic status and metadata SHALL be derived from the union of both evidence sets

