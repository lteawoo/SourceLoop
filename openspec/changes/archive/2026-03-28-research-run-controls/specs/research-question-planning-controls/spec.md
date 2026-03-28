## ADDED Requirements

### Requirement: Topic-backed planning SHALL support bounded question counts
The system SHALL allow operators to request fewer than the default planned questions when creating a topic-backed research batch.

#### Scenario: Operator limits question count at plan time
- **WHEN** the operator runs `plan` with a maximum-question option for a topic-backed batch
- **THEN** the generated batch SHALL contain no more than that many questions
- **AND** the batch metadata SHALL record the applied maximum-question value

#### Scenario: Operator omits the limit option
- **WHEN** the operator runs `plan` without a maximum-question option
- **THEN** the planner SHALL keep the existing default question count behavior

### Requirement: Topic-backed planning SHALL support question-family selection
The system SHALL allow operators to constrain planning to a selected subset of supported question families.

#### Scenario: Operator selects specific families
- **WHEN** the operator runs `plan` with one or more supported family names
- **THEN** the generated batch SHALL include only questions derived from those families
- **AND** the batch metadata SHALL record the selected families in batch order

#### Scenario: Operator requests an unsupported family
- **WHEN** the operator supplies a family name that the planner does not support
- **THEN** the CLI SHALL fail with a clear validation error
- **AND** no batch artifacts SHALL be created

### Requirement: Planned question notes SHALL show planning scope
The system SHALL render enough planner metadata in the question batch archive to explain why the batch contains its current shape.

#### Scenario: Batch is planned with a custom scope
- **WHEN** a question batch is created with a reduced question count or selected families
- **THEN** the questions note SHALL render that planning scope
- **AND** the run metadata SHALL preserve the same scope for later review
