import { describe, expect, it } from "vitest";
import {
  didImportProduceNewMatchingCandidate,
  getManagedImportSuccessNeedles,
  isLikelyCitationOverflowControl,
  shouldExpandCitationOverflowControl,
  type ManagedNotebookBrowserImportInput,
  type NotebookLMCitationOverflowCandidate
} from "../src/core/notebooklm/browser-agent.js";

describe("NotebookLM browser agent overflow controls", () => {
  it("identifies likely citation overflow controls", () => {
    const candidates: NotebookLMCitationOverflowCandidate[] = [
      {
        overflowId: "overflow-1",
        text: "...",
        selector: "button",
        citationAdjacent: true
      },
      {
        overflowId: "overflow-2",
        ariaLabel: "Show more citations",
        selector: "[role=\"button\"]",
        citationAdjacent: true
      },
      {
        overflowId: "overflow-3",
        text: "more_horiz",
        className: "citation-overflow-trigger",
        selector: "button",
        citationAdjacent: true
      }
    ];

    expect(candidates.every((candidate) => isLikelyCitationOverflowControl(candidate))).toBe(true);
    expect(candidates.every((candidate) => shouldExpandCitationOverflowControl(candidate))).toBe(true);
  });

  it("does not misclassify normal answer controls as citation overflow", () => {
    const candidates: NotebookLMCitationOverflowCandidate[] = [
      {
        overflowId: "copy",
        ariaLabel: "Copy answer",
        selector: "button",
        citationAdjacent: true
      },
      {
        overflowId: "thumb-up",
        ariaLabel: "Good response",
        selector: "button",
        citationAdjacent: true
      },
      {
        overflowId: "share",
        text: "share",
        selector: "[role=\"button\"]",
        citationAdjacent: true
      }
    ];

    expect(candidates.some((candidate) => isLikelyCitationOverflowControl(candidate))).toBe(false);
    expect(candidates.some((candidate) => shouldExpandCitationOverflowControl(candidate))).toBe(false);
  });

  it("requires citation adjacency before expanding generic overflow controls", () => {
    const candidate: NotebookLMCitationOverflowCandidate = {
      overflowId: "overflow-generic",
      text: "...",
      selector: "button",
      citationAdjacent: false
    };

    expect(isLikelyCitationOverflowControl(candidate)).toBe(true);
    expect(shouldExpandCitationOverflowControl(candidate)).toBe(false);
  });

  it("only treats new matching source candidates as managed import success", () => {
    const input: ManagedNotebookBrowserImportInput = {
      importKind: "web_url",
      title: "Managed Import Title",
      sourceUri: "https://example.com/article",
      url: "https://example.com/article"
    };

    const baseline = [{ signature: "existing", text: "Managed Import Title" }];
    const unchanged = [{ signature: "existing", text: "Managed Import Title" }];
    const imported = [
      ...unchanged,
      { signature: "new-source-row", text: "Managed Import Title https://example.com/article" }
    ];

    expect(getManagedImportSuccessNeedles(input)).toContain("managed import title");
    expect(didImportProduceNewMatchingCandidate(baseline, unchanged, input)).toBe(false);
    expect(didImportProduceNewMatchingCandidate(baseline, imported, input)).toBe(true);
  });
});
