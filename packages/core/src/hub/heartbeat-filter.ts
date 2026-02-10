import { stripHeartbeatToken } from "../heartbeat/index.js";

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Extract assistant text from an agent stream event.
 * Supports both string and rich content-array message shapes.
 */
export function extractAssistantEventText(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const message = (event as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;

  if (typeof content === "string") {
    return collapseWhitespace(content);
  }

  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) {
      parts.push(text);
    }
  }
  return collapseWhitespace(parts.join("\n"));
}

/**
 * True only for pure heartbeat ACK payloads (e.g. "HEARTBEAT_OK").
 * Messages that include any extra text are not suppressed.
 */
export function isHeartbeatAckEvent(event: unknown): boolean {
  const text = extractAssistantEventText(event);
  if (!text) return false;
  const stripped = stripHeartbeatToken(text, { mode: "message" });
  return stripped.shouldSkip && stripped.didStrip;
}

