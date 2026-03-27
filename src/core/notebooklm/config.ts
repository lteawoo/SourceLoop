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

export const NOTEBOOKLM_THINKING_SELECTOR = "div.thinking-message";
export const NOTEBOOKLM_DEFAULT_URL = "https://notebooklm.google.com/";
