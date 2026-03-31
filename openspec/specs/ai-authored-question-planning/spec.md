# ai-authored-question-planning Specification

## Purpose
TBD - created by archiving change ai-authored-question-planning. Update Purpose after archive.
## Requirements
### Requirement: Topic-backed planning SHALL accept AI-authored question drafts
The system SHALL allow operators to provide a topic-specific batch of AI-authored question drafts when creating a research plan.

#### Scenario: Operator imports a valid AI-authored question batch
- **WHEN** the operator runs `plan` with a valid AI-authored question file
- **THEN** SourceLoop SHALL create the batch from the authored prompts and objectives in file order
- **AND** SourceLoop SHALL assign SourceLoop-managed question identifiers and archive the resulting batch using the normal planning artifacts

#### Scenario: Operator omits an AI-authored question file
- **WHEN** the operator runs `plan` without an AI-authored question file
- **THEN** SourceLoop SHALL preserve the existing built-in template planning behavior

### Requirement: AI-authored question drafts SHALL be validated before planning artifacts are written
The system SHALL reject malformed or unsupported AI-authored question input before creating a planned run or question batch archive.

#### Scenario: Question draft uses an unsupported family
- **WHEN** the AI-authored question file contains a question family that SourceLoop does not support
- **THEN** the CLI SHALL fail with a validation error
- **AND** no run or question batch artifacts SHALL be written

#### Scenario: Question draft omits required fields
- **WHEN** the AI-authored question file contains a question without a required prompt, objective, or family
- **THEN** the CLI SHALL fail with a validation error
- **AND** no run or question batch artifacts SHALL be written

#### Scenario: Planning scope removes all imported questions
- **WHEN** the operator applies planning controls and the resulting AI-authored batch would contain zero questions
- **THEN** the CLI SHALL fail with a clear error
- **AND** no run or question batch artifacts SHALL be written

