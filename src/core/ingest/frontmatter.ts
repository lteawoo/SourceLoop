type FrontmatterValue = string | string[] | undefined;

type FrontmatterRecord = Record<string, FrontmatterValue>;

export function toFrontmatterMarkdown(metadata: FrontmatterRecord, body: string): string {
  const lines = ["---"];

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      lines.push(`${key}:`);

      if (value.length === 0) {
        lines.push("  []");
      } else {
        for (const entry of value) {
          lines.push(`  - ${escapeScalar(entry)}`);
        }
      }

      continue;
    }

    lines.push(`${key}: ${escapeScalar(value)}`);
  }

  lines.push("---", "", body.trimEnd(), "");
  return lines.join("\n");
}

function escapeScalar(value: string): string {
  if (/^[A-Za-z0-9._:/-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

