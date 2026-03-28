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

export const NOTEBOOKLM_CREATE_NOTEBOOK_SELECTORS = [
  'button[aria-label*="Create" i]',
  'button[aria-label*="New notebook" i]',
  'button:has-text("Create")',
  'button:has-text("New notebook")',
  'button:has-text("새 노트북")',
  'button:has-text("만들기")'
] as const;

export const NOTEBOOKLM_NOTEBOOK_TITLE_INPUT_SELECTORS = [
  'input[aria-label*="title" i]',
  'input[placeholder*="title" i]',
  'textarea[aria-label*="title" i]'
] as const;

export const NOTEBOOKLM_ADD_SOURCE_SELECTORS = [
  'button[aria-label*="Add source" i]',
  'button[aria-label*="Add" i]',
  'button:has-text("Add source")',
  'button:has-text("Add")',
  'button:has-text("소스 추가")',
  'button:has-text("추가")'
] as const;

export const NOTEBOOKLM_IMPORT_URL_OPTION_SELECTORS = [
  'button:has-text("Website")',
  'button:has-text("웹사이트")',
  'button:has-text("YouTube")',
  'button:has-text("Link")',
  'button:has-text("URL")'
] as const;

export const NOTEBOOKLM_IMPORT_URL_INPUT_SELECTORS = [
  'input[type="url"]',
  'input[placeholder*="https"]',
  'input[placeholder*="youtube" i]',
  'textarea[placeholder*="https"]'
] as const;

export const NOTEBOOKLM_IMPORT_FILE_OPTION_SELECTORS = [
  'button:has-text("Upload")',
  'button:has-text("File")',
  'button:has-text("문서")',
  'button:has-text("업로드")'
] as const;

export const NOTEBOOKLM_IMPORT_FILE_INPUT_SELECTORS = [
  'input[type="file"]'
] as const;

export const NOTEBOOKLM_IMPORT_SUBMIT_SELECTORS = [
  'button[aria-label*="Insert" i]',
  'button[aria-label*="Import" i]',
  'button[aria-label*="Add" i]',
  'button[type="submit"]',
  'button:has-text("Insert")',
  'button:has-text("Import")',
  'button:has-text("Add")',
  'button:has-text("추가")',
  'button:has-text("가져오기")'
] as const;

export const NOTEBOOKLM_IMPORT_ERROR_SELECTORS = [
  '[role="alert"]',
  '.error',
  '.mat-mdc-snack-bar-label'
] as const;

export const NOTEBOOKLM_IMPORT_SUCCESS_CANDIDATE_SELECTORS = [
  '[data-testid*="source" i]',
  '[data-test-id*="source" i]',
  '[aria-label*="source" i]',
  '[aria-label*="출처"]',
  '[role="listitem"]',
  'mat-expansion-panel',
  'mat-list-item',
  '.source-item',
  '.source-card'
] as const;

export const NOTEBOOKLM_THINKING_SELECTOR = "div.thinking-message";
export const NOTEBOOKLM_DEFAULT_URL = "https://notebooklm.google.com/";
