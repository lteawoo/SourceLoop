# research-run-execution-controls Specification

## Purpose
TBD - created by archiving change research-run-controls. Update Purpose after archive.
## Requirements
### Requirement: Run execution SHALL support targeted question selection
The system SHALL allow operators to execute a subset of a planned batch by explicit question id or by starting position within the batch order.

#### Scenario: Operator targets explicit question ids
- **WHEN** the operator runs `run` with one or more planned question ids
- **THEN** the runner SHALL execute only those planned questions that are valid for the batch
- **AND** the run metadata SHALL record the selected question ids

#### Scenario: Operator starts from a later planned question
- **WHEN** the operator runs `run` with a start-from question selector
- **THEN** the runner SHALL begin execution at that question's position in batch order
- **AND** earlier planned questions SHALL be skipped for that execution pass

### Requirement: Run execution SHALL support bounded batch slices
The system SHALL allow operators to execute only a bounded number of planned questions in a single pass.

#### Scenario: Operator limits execution count
- **WHEN** the operator runs `run` with an execution limit
- **THEN** the runner SHALL stop after archiving at most that many newly executed questions
- **AND** the run status SHALL remain readable for a later follow-up execution pass

#### Scenario: Operator omits execution bounds
- **WHEN** the operator runs `run` without any execution-selection options
- **THEN** the runner SHALL preserve the existing behavior of continuing through remaining planned questions in order

### Requirement: Partial execution SHALL remain explicit in run archives
The system SHALL make partial or targeted execution visible in run notes and run metadata.

#### Scenario: Run executes only a subset of its batch
- **WHEN** a run executes only selected or bounded questions
- **THEN** the run archive SHALL record the execution scope alongside completion progress
- **AND** linked exchanges SHALL reflect only the questions actually executed in that pass

#### Scenario: Operator targets an invalid or unsupported question selection
- **WHEN** a run selector refers to a question that is not part of the batch or cannot be executed under current replay rules
- **THEN** the CLI SHALL fail with a clear validation error
- **AND** existing archived exchanges SHALL remain unchanged

