import { describe, expect, it } from "vitest";
import {
  extractCitationReferencesFromSnapshot,
  extractNormalizedAnswerFromSnapshot,
  normalizeNotebookLMAnswerText,
  type NotebookLMCitationCandidate,
  type NotebookLMResponseSnapshot
} from "../src/core/notebooklm/response-extraction.js";

describe("NotebookLM response extraction", () => {
  it("normalizes answer body text and removes obvious UI-only fragments", () => {
    const snapshot: NotebookLMResponseSnapshot = {
      responseText: "Professional web design relies on strong hierarchy.\n1\nmore_horiz\nUse bold layouts.",
      bodyTexts: [
        "Professional web design relies on strong hierarchy.\n1\nmore_horiz",
        "Use bold layouts."
      ],
      citationCandidates: []
    };

    expect(extractNormalizedAnswerFromSnapshot(snapshot)).toBe(
      "Professional web design relies on strong hierarchy.\n\nUse bold layouts."
    );
    expect(normalizeNotebookLMAnswerText("more_horiz\n1\nKeep the visual hierarchy tight.")).toBe(
      "Keep the visual hierarchy tight."
    );
    expect(normalizeNotebookLMAnswerText("A strong hierarchy\n.\nBecause contrast matters")).toBe(
      "A strong hierarchy.\nBecause contrast matters"
    );
    expect(normalizeNotebookLMAnswerText("A strong hierarchy\n. Because contrast matters")).toBe(
      "A strong hierarchy. Because contrast matters"
    );
  });

  it("preserves inline citation anchors that are already part of normalized answer body text", () => {
    const snapshot: NotebookLMResponseSnapshot = {
      responseText: "",
      bodyTexts: [
        "Claude should use a claude.md file for project rules. [1][2]",
        "The screenshot loop can self-correct UI drift. [3]"
      ],
      citationCandidates: []
    };

    expect(extractNormalizedAnswerFromSnapshot(snapshot)).toBe(
      "Claude should use a claude.md file for project rules. [1][2]\n\nThe screenshot loop can self-correct UI drift. [3]"
    );
  });

  it("extracts structured citations from visible metadata and ignores UI-only controls", () => {
    const candidates: NotebookLMCitationCandidate[] = [
      {
        text: "1",
        ariaLabel: "Source 1",
        href: "https://example.com/source-1",
        selector: '[aria-label*="source" i]'
      },
      {
        text: "Design-System-Audit.pdf",
        title: "Design-System-Audit.pdf"
      },
      {
        text: "more_horiz",
        ariaLabel: "More actions"
      }
    ];

    expect(extractCitationReferencesFromSnapshot(candidates)).toEqual([
      {
        label: "1",
        href: "https://example.com/source-1"
      },
      {
        label: "Design-System-Audit.pdf",
        sourcePath: "Design-System-Audit.pdf"
      }
    ]);
  });

  it("captures notebooklm inline citation marker metadata", () => {
    const candidates: NotebookLMCitationCandidate[] = [
      {
        text: "1",
        ariaLabel: "1: Building Beautiful Websites with Claude Code Is Too Easy",
        popoverText: "open up a project so that we can start working with some files",
        dialogLabel: "인용 세부정보",
        triggerDescription: "클릭하여 인용 세부정보 열기",
        selector: ".citation-marker [aria-label]"
      },
      {
        text: "1",
        dialogLabel: "인용 세부정보",
        triggerDescription: "클릭하여 인용 세부정보 열기",
        selector: ".citation-marker",
        className: "xap-inline-dialog citation-marker"
      }
    ];

    expect(extractCitationReferencesFromSnapshot(candidates)).toEqual([
      {
        label: "1",
        note: "Building Beautiful Websites with Claude Code Is Too Easy | open up a project so that we can start working with some files"
      }
    ]);
  });

  it("trims obvious broken leading snippet fragments from citation notes", () => {
    const candidates: NotebookLMCitationCandidate[] = [
      {
        text: "13",
        ariaLabel: "13: Building Beautiful Websites with Claude Code Is Too Easy",
        popoverText: "nity it also changed this iPhone thing to member growth this month",
        selector: ".citation-marker [aria-label]"
      },
      {
        text: "24",
        ariaLabel: "24: Building Beautiful Websites with Claude Code Is Too Easy",
        popoverText: "lse you can do which is kind of a bonus hack",
        selector: ".citation-marker [aria-label]"
      }
    ];

    expect(extractCitationReferencesFromSnapshot(candidates)).toEqual([
      {
        label: "13",
        note: "Building Beautiful Websites with Claude Code Is Too Easy | it also changed this iPhone thing to member growth this month"
      },
      {
        label: "24",
        note: "Building Beautiful Websites with Claude Code Is Too Easy | you can do which is kind of a bonus hack"
      }
    ]);
  });

  it("trims additional clipped-leading transcript fragments from citation notes", () => {
    const candidates: NotebookLMCitationCandidate[] = [
      {
        text: "5",
        ariaLabel: "5: Building Beautiful Websites with Claude Code Is Too Easy",
        popoverText: "e is always invoke the front-end design skill before writing any front-end code",
        selector: ".citation-marker [aria-label]"
      },
      {
        text: "14",
        ariaLabel: "14: Building Beautiful Websites with Claude Code Is Too Easy",
        popoverText: "ts you might be able to find it's got shaders it's got backgrounds",
        selector: ".citation-marker [aria-label]"
      },
      {
        text: "22",
        ariaLabel: "22: Building Beautiful Websites with Claude Code Is Too Easy",
        popoverText: "me a GitHub repository and it could actually do that",
        selector: ".citation-marker [aria-label]"
      }
    ];

    expect(extractCitationReferencesFromSnapshot(candidates)).toEqual([
      {
        label: "5",
        note: "Building Beautiful Websites with Claude Code Is Too Easy | is always invoke the front-end design skill before writing any front-end code"
      },
      {
        label: "14",
        note: "Building Beautiful Websites with Claude Code Is Too Easy | you might be able to find it's got shaders it's got backgrounds"
      },
      {
        label: "22",
        note: "Building Beautiful Websites with Claude Code Is Too Easy | a GitHub repository and it could actually do that"
      }
    ]);
  });

  it("merges duplicate citation labels and keeps the richer note", () => {
    const candidates: NotebookLMCitationCandidate[] = [
      {
        text: "1",
        ariaLabel: "1: Building Beautiful Websites with Claude Code Is Too Easy",
        selector: ".citation-marker [aria-label]"
      },
      {
        text: "1",
        ariaLabel: "1: Building Beautiful Websites with Claude Code Is Too Easy",
        popoverText:
          "open up a project so that we can start working with some files and create one to start and then open that up",
        selector: ".citation-marker [aria-label]"
      }
    ];

    expect(extractCitationReferencesFromSnapshot(candidates)).toEqual([
      {
        label: "1",
        note: "Building Beautiful Websites with Claude Code Is Too Easy | open up a project so that we can start working with some files and create one to start and then open that up"
      }
    ]);
  });

  it("does not treat generic hyperlinks as citations unless the selector implies reference UI", () => {
    const genericLinkCandidates: NotebookLMCitationCandidate[] = [
      {
        text: "https://example.com/demo",
        href: "https://example.com/demo",
        selector: "a[href]"
      }
    ];

    expect(extractCitationReferencesFromSnapshot(genericLinkCandidates)).toEqual([
      {
        label: "NotebookLM UI citation not captured",
        note: "No visible citation metadata was extracted from the latest answer."
      }
    ]);

    const sourceUiLinkCandidates: NotebookLMCitationCandidate[] = [
      {
        text: "https://example.com/source-2",
        href: "https://example.com/source-2",
        selector: '[data-testid*="source" i]'
      }
    ];

    expect(extractCitationReferencesFromSnapshot(sourceUiLinkCandidates)).toEqual([
      {
        label: "https://example.com/source-2",
        href: "https://example.com/source-2"
      }
    ]);
  });

  it("preserves the fallback citation record only when no visible citation metadata is available", () => {
    const candidates: NotebookLMCitationCandidate[] = [
      {
        text: "more_horiz",
        ariaLabel: "More actions"
      },
      {
        text: "thumb_up",
        ariaLabel: "Good response"
      }
    ];

    expect(extractCitationReferencesFromSnapshot(candidates)).toEqual([
      {
        label: "NotebookLM UI citation not captured",
        note: "No visible citation metadata was extracted from the latest answer."
      }
    ]);
  });
});
