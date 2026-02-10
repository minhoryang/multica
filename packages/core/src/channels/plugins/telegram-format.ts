/**
 * Markdown → Telegram HTML converter.
 *
 * Telegram supports a subset of HTML:
 *   <b>, <i>, <u>, <s>, <code>, <pre>, <a href="...">, <blockquote>
 *
 * Strategy:
 * 1. Extract code blocks and inline code (protect from further processing)
 * 2. Escape HTML entities in remaining text
 * 3. Convert Markdown syntax to HTML tags
 * 4. Restore code blocks
 */

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert Markdown text to Telegram-compatible HTML.
 * Handles: bold, italic, strikethrough, inline code, code blocks, links, blockquotes.
 */
export function markdownToTelegramHtml(markdown: string): string {
  // Placeholder system: replace code blocks/inline code with placeholders,
  // process markdown on the rest, then restore.
  const placeholders: string[] = [];
  const placeholder = (content: string): string => {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\x00PH${idx}\x00`;
  };

  let text = markdown;

  // 1. Fenced code blocks: ```lang\n...\n```
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const escaped = escapeHtml(code.replace(/\n$/, ""));
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    return placeholder(`<pre><code${langAttr}>${escaped}</code></pre>`);
  });

  // 2. Inline code: `...`
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    return placeholder(`<code>${escapeHtml(code)}</code>`);
  });

  // 3. Escape HTML in remaining text
  text = escapeHtml(text);

  // 4. Links: [text](url) — escape quotes in URL to prevent attribute breakout
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) =>
    `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`,
  );

  // 5. Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");

  // 6. Italic: *text* or _text_ (but not inside words with underscores)
  text = text.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "<i>$1</i>");
  text = text.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "<i>$1</i>");

  // 7. Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 8. Blockquotes: > text (at line start)
  text = text.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  // Merge adjacent blockquotes
  text = text.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // 9. Headings: strip # markers, make bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Restore placeholders
  text = text.replace(/\x00PH(\d+)\x00/g, (_match, idx: string) => placeholders[Number(idx)]!);

  return text;
}
