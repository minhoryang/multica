import TurndownService from "turndown";

export type ExtractMode = "markdown" | "text";
export type ExtractorType = "readability" | "turndown";

export type ExtractResult = {
  text: string;
  title?: string;
};

export type ExtractResultWithExtractor = ExtractResult & {
  extractor: ExtractorType;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ""));
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || !titleMatch[1]) return undefined;
  const title = normalizeWhitespace(stripTags(titleMatch[1]));
  return title || undefined;
}

function buildResult(text: string, title: string | undefined): ExtractResult {
  if (title) {
    return { text, title };
  }
  return { text };
}

function buildResultWithExtractor(
  text: string,
  title: string | undefined,
  extractor: ExtractorType,
): ExtractResultWithExtractor {
  if (title) {
    return { text, title, extractor };
  }
  return { text, extractor };
}

export function htmlToMarkdownSimple(html: string): ExtractResult {
  const title = extractTitle(html);
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
    const label = normalizeWhitespace(stripTags(body));
    if (!label) return href;
    return `[${label}](${href})`;
  });
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => {
    const prefix = "#".repeat(Math.max(1, Math.min(6, Number.parseInt(level, 10))));
    const label = normalizeWhitespace(stripTags(body));
    return `\n${prefix} ${label}\n`;
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => {
    const label = normalizeWhitespace(stripTags(body));
    return label ? `\n- ${label}` : "";
  });
  text = text
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|table|tr|ul|ol)>/gi, "\n");
  text = stripTags(text);
  text = normalizeWhitespace(text);
  return buildResult(text, title);
}

export function markdownToText(markdown: string): string {
  let text = markdown;
  text = text.replace(/!\[[^\]]*]\([^)]+\)/g, "");
  text = text.replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
  text = text.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/```[^\n]*\n?/g, "").replace(/```/g, ""),
  );
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  return normalizeWhitespace(text);
}

export function truncateText(
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}

/**
 * Convert HTML to markdown using TurndownService (simpler, converts whole page)
 */
export function convertWithTurndown(html: string): ExtractResult {
  const title = extractTitle(html);

  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndownService.remove(["script", "style", "meta", "link", "noscript"]);

  const text = normalizeWhitespace(turndownService.turndown(html));
  return buildResult(text, title);
}

/**
 * Extract readable content using Mozilla Readability (smarter, extracts main content)
 */
export async function extractWithReadability(params: {
  html: string;
  url: string;
  extractMode: ExtractMode;
}): Promise<ExtractResult | null> {
  const fallback = (): ExtractResult => {
    const rendered = htmlToMarkdownSimple(params.html);
    if (params.extractMode === "text") {
      const text = markdownToText(rendered.text) || normalizeWhitespace(stripTags(params.html));
      return buildResult(text, rendered.title);
    }
    return rendered;
  };

  try {
    const [{ Readability }, { parseHTML }] = await Promise.all([
      import("@mozilla/readability"),
      import("linkedom"),
    ]);
    const { document } = parseHTML(params.html);
    try {
      (document as { baseURI?: string }).baseURI = params.url;
    } catch {
      // Best-effort base URI for relative links.
    }
    const reader = new Readability(document, { charThreshold: 0 });
    const parsed = reader.parse();
    if (!parsed?.content) return fallback();
    const title = parsed.title || undefined;
    if (params.extractMode === "text") {
      const text = normalizeWhitespace(parsed.textContent ?? "");
      if (!text) return fallback();
      return buildResult(text, title);
    }
    const rendered = htmlToMarkdownSimple(parsed.content);
    return buildResult(rendered.text, title ?? rendered.title);
  } catch {
    return fallback();
  }
}

/**
 * Extract content from HTML using the specified extractor
 */
export async function extractContent(params: {
  html: string;
  url: string;
  extractMode: ExtractMode;
  extractor: ExtractorType;
}): Promise<ExtractResultWithExtractor> {
  if (params.extractor === "turndown") {
    const result = convertWithTurndown(params.html);
    const text = params.extractMode === "text" ? markdownToText(result.text) : result.text;
    return buildResultWithExtractor(text, result.title, "turndown");
  }

  // Default: readability
  const result = await extractWithReadability({
    html: params.html,
    url: params.url,
    extractMode: params.extractMode,
  });

  if (result) {
    return buildResultWithExtractor(result.text, result.title, "readability");
  }

  // Fallback to turndown if readability fails
  const fallback = convertWithTurndown(params.html);
  const text = params.extractMode === "text" ? markdownToText(fallback.text) : fallback.text;
  return buildResultWithExtractor(text, fallback.title, "turndown");
}
