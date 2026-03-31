## 1. Planning Input Contract

- [x] 1.1 Add a validated draft-question schema for AI-authored planning input
- [x] 1.2 Extend the `plan` CLI to accept a `--questions-file` JSON input path
- [x] 1.3 Fail planning before artifact creation when imported question drafts are malformed or unsupported

## 2. Planner Integration

- [x] 2.1 Normalize validated AI-authored drafts into the existing planned-question archive contract
- [x] 2.2 Apply `families` and `maxQuestions` controls to AI-authored batches as the final planning scope
- [x] 2.3 Preserve the built-in template planner as the fallback path when no AI-authored question file is supplied

## 3. Documentation and Verification

- [x] 3.1 Update README and operator playbooks to document the preferred AI-authored question workflow
- [x] 3.2 Add tests covering valid AI-authored planning, scope application, and fail-closed validation behavior
- [x] 3.3 Run build and test verification for the new planning path
