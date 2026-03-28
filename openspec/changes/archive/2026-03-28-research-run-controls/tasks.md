## 1. Planner Controls

- [x] 1.1 Extend `plan` CLI parsing to accept maximum-question and family-selection options
- [x] 1.2 Update the question planner to filter/generate batches according to the selected families and count limit
- [x] 1.3 Persist and render planning-scope metadata in question batch and run artifacts

## 2. Run Controls

- [x] 2.1 Extend `run` CLI parsing to accept targeted-question, start-from, and execution-limit options
- [x] 2.2 Update run execution logic to resolve selected question slices without changing default full-run behavior
- [x] 2.3 Persist and render execution-scope metadata for partial and targeted runs

## 3. Verification

- [x] 3.1 Add automated coverage for bounded planning and family-filter planning
- [x] 3.2 Add automated coverage for targeted and limited run execution flows
- [x] 3.3 Update operator docs with the recommended research-control workflow
