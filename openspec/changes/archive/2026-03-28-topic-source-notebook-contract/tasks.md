## 1. Notebook Source Manifest Model

- [x] 1.1 Add a `NotebookSourceManifest` schema and vault note/json storage
- [x] 1.2 Add CLI commands to declare and inspect notebook-source manifests tied to a topic and notebook binding
- [x] 1.3 Render manifest notes as Obsidian-friendly artifacts with topic/notebook wikilinks

## 2. Topic Corpus Contract

- [x] 2.1 Extend topic corpus manifests to track notebook-source manifest ids
- [x] 2.2 Update topic refresh/status logic to treat local sources and notebook-source manifests as equivalent evidence inputs
- [x] 2.3 Update run/planning preflight checks so notebook-backed evidence satisfies the corpus requirement

## 3. Documentation and Verification

- [x] 3.1 Add automated coverage for notebook-source declaration and corpus aggregation
- [x] 3.2 Add automated coverage for notebook-backed preflight success and missing-evidence failure
- [x] 3.3 Update README and test docs to replace the fake local anchor note with notebook-source declaration in the preferred workflow
