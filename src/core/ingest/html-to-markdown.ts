export function htmlToMarkdown(html: string): { title: string; body: string; language?: string } {
  const title = extractTitle(html) ?? "Untitled";
  const language = extractLanguage(html);
  const stripped = stripHtmlToText(html);
  const body = `# ${title}\n\n${stripped}`.trim();

  return language
    ? {
        title,
        body,
        language
      }
    : {
        title,
        body
      };
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!match) {
    return undefined;
  }

  return decodeEntities(match[1] ?? "").trim();
}

function extractLanguage(html: string): string | undefined {
  const match = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);

  return match?.[1]?.trim() || undefined;
}

function stripHtmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const blockSeparated = withoutScripts
    .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6|br)>/gi, "\n")
    .replace(/<(ul|ol)>/gi, "\n")
    .replace(/<(li)>/gi, "- ");

  const noTags = blockSeparated.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(noTags);

  return decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
