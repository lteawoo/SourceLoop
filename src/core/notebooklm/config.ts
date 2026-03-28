export const NOTEBOOKLM_QUERY_INPUT_SELECTORS = [
  "textarea.query-box-input",
  'textarea[aria-label="Input for queries"]',
  'textarea[aria-label="Feld für Anfragen"]'
] as const;

export const NOTEBOOKLM_SUBMIT_SELECTORS = [
  'button[aria-label*="Send" i]',
  'button[aria-label*="Submit" i]',
  'button[aria-label*="Ask" i]',
  'button[aria-label*="send message" i]',
  'button[aria-label*="submit query" i]',
  'button[aria-label*="질문" i]',
  'button[aria-label*="전송" i]',
  'button[data-testid*="send" i]',
  'button[data-testid*="submit" i]',
  'button[type="submit"]'
] as const;

export const NOTEBOOKLM_RESPONSE_SELECTORS = [
  ".to-user-container .message-text-content",
  "[data-message-author='bot']",
  "[data-message-author='assistant']"
] as const;

export const NOTEBOOKLM_ANSWER_BODY_SELECTORS = [
  ".markdown",
  ".message-text-content p",
  ".message-text-content li",
  ".message-content p",
  ".message-content li",
  "p",
  "li"
] as const;

export const NOTEBOOKLM_CITATION_SELECTORS = [
  ".citation-marker",
  ".citation-marker [aria-label]",
  '[dialoglabel*="citation" i]',
  '[triggerdescription*="citation" i]',
  '[dialoglabel*="인용"]',
  '[triggerdescription*="인용"]',
  "a[href]",
  'button[aria-label]',
  '[aria-label]',
  '[role="button"][aria-label]',
  '[aria-label*="source" i]',
  '[aria-label*="sources" i]',
  '[aria-label*="citation" i]',
  '[aria-label*="reference" i]',
  '[aria-label*="출처" i]',
  '[aria-label*="근거" i]',
  '[data-testid*="source" i]',
  '[data-testid*="citation" i]'
] as const;

export const NOTEBOOKLM_CITATION_OVERFLOW_SELECTORS = [
  "button",
  '[role="button"]'
] as const;

export const NOTEBOOKLM_CITATION_POPOVER_SELECTORS = [
  ".cdk-overlay-pane .xap-inline-dialog-container",
  "xap-inline-dialog-container[role='dialog']",
  ".xap-inline-dialog-container[role='dialog']"
] as const;

export const NOTEBOOKLM_THINKING_SELECTOR = "div.thinking-message";
export const NOTEBOOKLM_DEFAULT_URL = "https://notebooklm.google.com/";
