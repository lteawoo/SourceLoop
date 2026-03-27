export function normalizeObsidianText(value: string | undefined, fallback = ""): string {
  if (!value) {
    return fallback;
  }

  return value.replace(/\s+/g, " ").trim();
}

export function makeAliases(...values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeObsidianText(value)).filter(Boolean))];
}

export function makeTags(...values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => normalizeObsidianText(value).toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
}

export function summarizeQuestionTitle(prompt: string, fallback: string, maxLength = 72): string {
  const normalized = normalizeObsidianText(prompt, fallback).replace(/[?!。.]+$/, "");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const trimmed = normalized.slice(0, maxLength);
  const boundary = trimmed.lastIndexOf(" ");
  const candidate = boundary > Math.floor(maxLength * 0.6) ? trimmed.slice(0, boundary) : trimmed;
  return `${candidate.trim()}...`;
}
