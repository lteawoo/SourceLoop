import { describe, expect, it } from "vitest";
import { NOTEBOOKLM_ANSWER_BODY_SELECTORS } from "../src/core/notebooklm/config.js";

describe("NotebookLM config", () => {
  it("includes rich paragraph div selectors for answer body extraction", () => {
    expect(NOTEBOOKLM_ANSWER_BODY_SELECTORS).toEqual(
      expect.arrayContaining([
        ".message-text-content div.paragraph.is-rich-chat-ui",
        ".message-content div.paragraph.is-rich-chat-ui",
        "div.paragraph.is-rich-chat-ui"
      ])
    );
  });
});
