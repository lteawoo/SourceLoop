import { describe, expect, it } from "vitest";
import {
  canonicalizeNotebookUrl,
  countRichNotebookLMCitations,
  didImportIncreaseVisibleSourceCount,
  ensureNotebookTargetMatch,
  didImportProduceNewMatchingCandidate,
  getManagedImportSuccessNeedles,
  hasNotebookLMCitationSnippet,
  isLikelyNotebookLMCitationMarker,
  isNotebookPageMatch,
  isLikelyCitationOverflowControl,
  parseNotebookSourceCount,
  shouldRetryNotebookLMCitationCapture,
  shouldTreatCitationMetadataAsSettled,
  shouldExpandCitationOverflowControl,
  type ManagedNotebookBrowserImportInput,
  type NotebookLMCitationOverflowCandidate
} from "../src/core/notebooklm/browser-agent.js";

describe("NotebookLM browser agent overflow controls", () => {
  it("keeps only real numeric citation markers and ignores overflow buttons", () => {
    expect(
      isLikelyNotebookLMCitationMarker({
        text: "2",
        dialogLabel: "인용 세부정보",
        triggerDescription: "클릭하여 인용 세부정보 열기"
      })
    ).toBe(true);

    expect(
      isLikelyNotebookLMCitationMarker({
        text: "more_horiz",
        ariaLabel: "추가 인용 표시하기"
      })
    ).toBe(false);
  });

  it("canonicalizes transient managed notebook URLs", () => {
    expect(canonicalizeNotebookUrl("https://notebooklm.google.com/notebook/abc?addSource=true")).toBe(
      "https://notebooklm.google.com/notebook/abc"
    );
    expect(canonicalizeNotebookUrl("https://notebooklm.google.com/notebook/abc?addSource=true&foo=bar#hash")).toBe(
      "https://notebooklm.google.com/notebook/abc?foo=bar"
    );
  });

  it("distinguishes target notebook pages from NotebookLM home redirects", () => {
    expect(isNotebookPageMatch(
      "https://notebooklm.google.com/notebook/abc?addSource=true",
      "https://notebooklm.google.com/notebook/abc"
    )).toBe(true);
    expect(isNotebookPageMatch(
      "https://notebooklm.google.com/",
      "https://notebooklm.google.com/notebook/abc"
    )).toBe(false);
    expect(() =>
      ensureNotebookTargetMatch(
        "https://notebooklm.google.com/",
        "https://notebooklm.google.com/notebook/abc"
      )
    ).toThrow(/did not open the requested notebook/i);
  });

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

  it("parses visible source counts from NotebookLM UI text", () => {
    expect(parseNotebookSourceCount("소스 1개")).toBe(1);
    expect(parseNotebookSourceCount("2 sources")).toBe(2);
    expect(parseNotebookSourceCount("Sources 12")).toBe(12);
    expect(parseNotebookSourceCount("no source count here")).toBeUndefined();
  });

  it("treats source count growth as import success even when row signatures are unchanged", () => {
    expect(didImportIncreaseVisibleSourceCount(1, 2)).toBe(true);
    expect(didImportIncreaseVisibleSourceCount(1, 1)).toBe(false);
    expect(didImportIncreaseVisibleSourceCount(undefined, 2)).toBe(false);
    expect(didImportIncreaseVisibleSourceCount(1, undefined)).toBe(false);
  });

  it("distinguishes title-only citations from citations with real snippets", () => {
    expect(hasNotebookLMCitationSnippet("Attention in transformers, step-by-step | Deep Learning Chapter 6")).toBe(false);
    expect(
      hasNotebookLMCitationSnippet(
        "Attention in transformers, step-by-step | Deep Learning Chapter 6 | 지난 장에서 우리는 방향이 성별에 어떻게 대응할 수 있는지 예를 보았다"
      )
    ).toBe(true);

    expect(
      countRichNotebookLMCitations([
        { label: "1", note: "Attention in transformers, step-by-step | Deep Learning Chapter 6" },
        {
          label: "2",
          note: "Attention in transformers, step-by-step | Deep Learning Chapter 6 | 실제 인용 스니펫이 여기에 붙는다"
        }
      ])
    ).toBe(1);
  });

  it("retries sparse citation captures when only title-only notes were extracted", () => {
    expect(
      shouldRetryNotebookLMCitationCapture([
        { label: "1", note: "Attention in transformers, step-by-step | Deep Learning Chapter 6" },
        { label: "2", note: "Attention in transformers, step-by-step | Deep Learning Chapter 6" },
        { label: "3", note: "Attention in transformers, step-by-step | Deep Learning Chapter 6" }
      ])
    ).toBe(true);

    expect(
      shouldRetryNotebookLMCitationCapture([
        {
          label: "1",
          note: "Attention in transformers, step-by-step | Deep Learning Chapter 6 | 실제 인용 스니펫이 여기에 붙는다"
        },
        {
          label: "2",
          note: "Attention in transformers, step-by-step | Deep Learning Chapter 6 | 또 다른 인용 스니펫"
        },
        {
          label: "3",
          note: "Attention in transformers, step-by-step | Deep Learning Chapter 6 | 세 번째 인용 스니펫"
        }
      ])
    ).toBe(false);
  });

  it("settles citation metadata quickly when no citation markers appear", () => {
    let state = shouldTreatCitationMetadataAsSettled({
      signature: "",
      latestSignature: "",
      stableCount: 0,
      emptyStableCount: 0
    });
    expect(state.settled).toBe(false);

    for (let index = 0; index < 5; index += 1) {
      state = shouldTreatCitationMetadataAsSettled({
        signature: "",
        latestSignature: "",
        stableCount: state.stableCount,
        emptyStableCount: state.emptyStableCount
      });
    }

    expect(state.settled).toBe(true);
    expect(state.stableCount).toBe(0);
  });
});
