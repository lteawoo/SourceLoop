import type { CitationReference } from "../../schemas/run.js";

export type NotebookLMCitationCandidate = {
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  href?: string | null;
  markerId?: string | null;
  popoverText?: string | null;
  selector?: string | null;
  dialogLabel?: string | null;
  triggerDescription?: string | null;
  dataTestId?: string | null;
  role?: string | null;
  className?: string | null;
};

export type NotebookLMResponseSnapshot = {
  responseText: string;
  bodyTexts: string[];
  citationCandidates: NotebookLMCitationCandidate[];
};

const UI_ONLY_TOKENS = new Set([
  "more_horiz",
  "more_vert",
  "thumb_up",
  "thumb_down",
  "content_copy",
  "refresh",
  "edit",
  "share",
  "open_in_new",
  "expand_more",
  "expand_less"
]);

const UI_ONLY_LABEL_PATTERNS = [
  /^more (actions|options)$/i,
  /^show more$/i,
  /^copy$/i,
  /^copy answer$/i,
  /^share$/i,
  /^open in new$/i,
  /^thumbs? up$/i,
  /^thumbs? down$/i,
  /^good response$/i,
  /^bad response$/i,
  /^edit$/i,
  /^retry$/i,
  /^refresh$/i
] as const;

const CITATION_HINT_PATTERNS = [
  /\bsource\b/i,
  /\bsources\b/i,
  /\bcitation\b/i,
  /\bcitations\b/i,
  /\breference\b/i,
  /\breferences\b/i,
  /출처/,
  /참고/,
  /근거/,
  /자료/
] as const;

const SOURCE_PATH_PATTERN = /(?:[\p{L}\p{N}_./-]+\.(?:md|pdf|txt|docx?|pptx?|xlsx?|csv|html?))/iu;
const LIKELY_FRAGMENT_WORDS = new Set([
  "e",
  "ts",
  "me",
  "nity",
  "lse",
  "ust",
  "nce",
  "t",
  "f",
  "nts",
  "spiration",
  "nother",
  "ven't"
]);

const NOTEBOOKLM_PLACEHOLDER_ANSWER_TEXTS = new Set([
  "getting the context...",
  "getting the gist...",
  "scanning the text...",
  "expanding the definition...",
  "evaluating comparative capabilities...",
  "documenting the execution..."
]);

const NOTEBOOKLM_PLACEHOLDER_ANSWER_PATTERNS = [
  /^(getting|scanning|evaluating|expanding|documenting)\b.*\.\.\.$/i,
  /^(getting|scanning|evaluating|expanding|documenting)\b.*…$/i
] as const;

export function normalizeNotebookLMAnswerText(rawText: string): string {
  const normalizedInput = normalizeWhitespace(rawText);
  if (!normalizedInput) {
    return "";
  }

  const lines = normalizedInput.split(/\r?\n/);
  const cleanedLines: string[] = [];

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line || isUiOnlyLine(line)) {
      continue;
    }

    const previousLine = cleanedLines[cleanedLines.length - 1];
    if (previousLine && isPunctuationOnlyLine(line)) {
      cleanedLines[cleanedLines.length - 1] = `${previousLine}${line}`;
      continue;
    }

    if (previousLine && startsWithDetachedPunctuation(line)) {
      cleanedLines[cleanedLines.length - 1] = `${previousLine}${line}`;
      continue;
    }

    if (previousLine === line) {
      continue;
    }

    cleanedLines.push(line);
  }

  const normalizedOutput = cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return isLikelyNotebookLMPlaceholderAnswerText(normalizedOutput) ? "" : normalizedOutput;
}

export function extractNormalizedAnswerFromSnapshot(snapshot: NotebookLMResponseSnapshot): string {
  const answerFromBodies = snapshot.bodyTexts
    .map((bodyText) => normalizeNotebookLMAnswerText(bodyText))
    .filter((bodyText) => bodyText.length > 0)
    .join("\n\n")
    .trim();

  if (answerFromBodies) {
    return answerFromBodies;
  }

  const fallback = normalizeNotebookLMAnswerText(snapshot.responseText);
  if (fallback) {
    return fallback;
  }

  return isLikelyNotebookLMPlaceholderAnswerText(snapshot.responseText) ? "" : snapshot.responseText.trim();
}

export function isLikelyNotebookLMPlaceholderAnswerText(rawText: string): boolean {
  const normalized = normalizeLine(rawText);
  if (!normalized) {
    return false;
  }

  if (NOTEBOOKLM_PLACEHOLDER_ANSWER_TEXTS.has(normalized.toLowerCase())) {
    return true;
  }

  return NOTEBOOKLM_PLACEHOLDER_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function extractCitationReferencesFromSnapshot(
  candidates: NotebookLMCitationCandidate[]
): CitationReference[] {
  const grouped = new Map<string, CitationReference>();

  for (const candidate of candidates) {
    const citation = normalizeCitationCandidate(candidate);
    if (!citation) {
      continue;
    }

    const key = citation.label;
    const existing = grouped.get(key);
    grouped.set(key, mergeCitationReferences(existing, citation));
  }

  const citations = [...grouped.values()];
  if (citations.length > 0) {
    return citations;
  }

  return [
    {
      label: "NotebookLM UI citation not captured",
      note: "No visible citation metadata was extracted from the latest answer."
    }
  ];
}

function normalizeCitationCandidate(candidate: NotebookLMCitationCandidate): CitationReference | undefined {
  const text = normalizeLine(candidate.text ?? "");
  const ariaLabel = normalizeLine(candidate.ariaLabel ?? "");
  const title = normalizeLine(candidate.title ?? "");
  const popoverText = normalizeLine(candidate.popoverText ?? "");
  const dialogLabel = normalizeLine(candidate.dialogLabel ?? "");
  const triggerDescription = normalizeLine(candidate.triggerDescription ?? "");
  const href = normalizeHref(candidate.href);
  const sourceTitle = extractCitationTitle(ariaLabel) ?? extractCitationTitle(title);
  const metadataBits = [ariaLabel, title, normalizeLine(candidate.dataTestId ?? ""), normalizeLine(candidate.className ?? "")]
    .filter(Boolean)
    .join(" | ");
  const label = pickCitationLabel(text, ariaLabel, title, href, metadataBits);
  const sourcePath = inferSourcePath([text, ariaLabel, title, dialogLabel, triggerDescription, href]);
  const note = normalizeCitationNote(
    [sourceTitle, popoverText]
    .filter((value) => value && value !== label)
    .filter((value, index, array) => array.indexOf(value) === index)
    .join(" | ")
    .trim(),
    sourceTitle
  );

  if (!label) {
    return undefined;
  }

  if (!looksLikeCitation(label, note ?? "", href, sourcePath, candidate.selector, sourceTitle, popoverText)) {
    return undefined;
  }

  if (isUiOnlyCitationLabel(label) && !href && !sourcePath) {
    return undefined;
  }

  if (/^\d+(?:\s*,\s*\d+)*$/.test(label) && !sourceTitle && !sourcePath && !href) {
    return undefined;
  }

  if (!sourceTitle && !sourcePath && !href && !popoverText) {
    return undefined;
  }

  return {
    label,
    ...(href ? { href } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(note ? { note } : {})
  };
}

function pickCitationLabel(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeLine(value);
    if (!normalized || isUiOnlyCitationLabel(normalized)) {
      continue;
    }

    return normalized;
  }

  return undefined;
}

function inferSourcePath(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const match = value.match(SOURCE_PATH_PATTERN);
    if (match) {
      return match[0];
    }
  }

  return undefined;
}

function mergeCitationReferences(existing: CitationReference | undefined, next: CitationReference): CitationReference {
  if (!existing) {
    return next;
  }

  const preferredHref = existing.href ?? next.href;
  const preferredSourcePath = existing.sourcePath ?? next.sourcePath;
  const mergedNote = pickBetterCitationNote(existing.note, next.note);

  return {
    label: existing.label,
    ...(preferredHref ? { href: preferredHref } : {}),
    ...(preferredSourcePath ? { sourcePath: preferredSourcePath } : {}),
    ...(mergedNote ? { note: mergedNote } : {})
  };
}

function pickBetterCitationNote(current?: string, incoming?: string): string | undefined {
  const currentNote = normalizeLine(current ?? "");
  const incomingNote = normalizeLine(incoming ?? "");
  if (!currentNote) {
    return incomingNote || undefined;
  }
  if (!incomingNote) {
    return currentNote;
  }

  if (incomingNote.length > currentNote.length) {
    return incomingNote;
  }

  return currentNote;
}

function normalizeCitationNote(note: string, sourceTitle?: string): string | undefined {
  let normalized = normalizeLine(note);
  if (!normalized) {
    return undefined;
  }

  if (sourceTitle) {
    const escapedTitle = escapeRegExp(sourceTitle);
    normalized = normalized.replace(new RegExp(`(?:\\s*\\|\\s*)?${escapedTitle}$`, "iu"), "").trim();
    normalized = normalized.replace(new RegExp(`${escapedTitle}$`, "iu"), "").trim();
  }

  normalized = normalized.replace(/^\.\.\./, "").trim();
  normalized = normalized.replace(/^["'“”‘’.,;:!?-]+\s*/, "").trim();
  normalized = normalizeCitationNoteSegments(normalized);
  normalized = normalized.replace(/\s+([.,;:!?])/g, "$1").trim();

  const maxLength = 240;
  if (normalized.length > maxLength) {
    normalized = `${normalized.slice(0, maxLength).trimEnd()}...`;
  }

  if (!normalized) {
    return sourceTitle ? normalizeLine(sourceTitle) : undefined;
  }

  return normalized;
}

function normalizeCitationNoteSegments(value: string): string {
  const segments = value
    .split(/\s+\|\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length <= 1) {
    return trimBrokenLeadingSnippetToken(value);
  }

  const [head, ...tail] = segments;
  return [head, ...tail.map((segment) => trimBrokenLeadingSnippetToken(segment))].join(" | ");
}

function trimBrokenLeadingSnippetToken(value: string): string {
  const normalized = normalizeLine(value);
  const match = normalized.match(/^([a-z][a-z'’-]{0,9})\s+(.+)$/u);
  if (!match) {
    return normalized;
  }

  const firstToken = match[1];
  const remainder = match[2];
  if (!firstToken || !remainder) {
    return normalized;
  }

  if (firstToken !== firstToken.toLowerCase()) {
    return normalized;
  }

  if (LIKELY_FRAGMENT_WORDS.has(firstToken.toLowerCase())) {
    return remainder.trim();
  }

  return normalized;
}

function looksLikeCitation(
  label: string,
  note: string,
  href?: string,
  sourcePath?: string,
  selector?: string | null,
  sourceTitle?: string,
  popoverText?: string
): boolean {
  if (sourcePath) {
    return true;
  }

  if (sourceTitle) {
    return true;
  }

  if (popoverText) {
    return true;
  }

  if (/^\d+(?:\s*,\s*\d+)*$/.test(label)) {
    return true;
  }

  const combined = `${label} ${note}`.trim();
  if (CITATION_HINT_PATTERNS.some((pattern) => pattern.test(combined))) {
    return true;
  }

  if (href && selectorImpliesCitation(selector)) {
    return true;
  }

  return false;
}

function normalizeHref(href?: string | null): string | undefined {
  const normalized = normalizeLine(href ?? "");
  return normalized || undefined;
}

function normalizeWhitespace(value?: string | null): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim();
}

function normalizeLine(value?: string | null): string {
  return normalizeWhitespace(value).replace(/[ \t]+/g, " ");
}

function isUiOnlyLine(value: string): boolean {
  const normalized = normalizeLine(value);
  if (!normalized) {
    return true;
  }

  if (UI_ONLY_TOKENS.has(normalized.toLowerCase())) {
    return true;
  }

  if (/^\d+$/.test(normalized)) {
    return true;
  }

  return UI_ONLY_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isUiOnlyCitationLabel(value: string): boolean {
  const normalized = normalizeLine(value);
  if (!normalized) {
    return true;
  }

  if (UI_ONLY_TOKENS.has(normalized.toLowerCase())) {
    return true;
  }

  return UI_ONLY_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function selectorImpliesCitation(selector?: string | null): boolean {
  const normalized = normalizeLine(selector);
  if (!normalized) {
    return false;
  }

  return /source|citation|reference|출처|근거/i.test(normalized) || normalized !== "a[href]";
}

function extractCitationTitle(value?: string | null): string | undefined {
  const normalized = normalizeLine(value);
  if (!normalized) {
    return undefined;
  }

  const numbered = normalized.match(/^\d+\s*:\s*(.+)$/);
  if (numbered?.[1]) {
    return normalizeLine(numbered[1]);
  }

  return undefined;
}

function isPunctuationOnlyLine(value: string): boolean {
  return /^[.,;:!?]+$/.test(normalizeLine(value));
}

function startsWithDetachedPunctuation(value: string): boolean {
  return /^[.,;:!?]+\s+/.test(normalizeLine(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
