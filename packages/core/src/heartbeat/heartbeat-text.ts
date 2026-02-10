export const HEARTBEAT_TOKEN = "HEARTBEAT_OK";

export const HEARTBEAT_PROMPT =
  "Read heartbeat.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.";

export const DEFAULT_HEARTBEAT_EVERY = "30m";
export const DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300;

export function isHeartbeatContentEffectivelyEmpty(
  content: string | undefined | null,
): boolean {
  if (content === undefined || content === null || typeof content !== "string") {
    return false;
  }

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#+(\s|$)/.test(trimmed)) continue;
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
    return false;
  }

  return true;
}

export function resolveHeartbeatPrompt(raw?: string): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || HEARTBEAT_PROMPT;
}

export type StripHeartbeatMode = "heartbeat" | "message";

function stripTokenAtEdges(raw: string): { text: string; didStrip: boolean } {
  let text = raw.trim();
  if (!text) return { text: "", didStrip: false };
  if (!text.includes(HEARTBEAT_TOKEN)) return { text, didStrip: false };

  let didStrip = false;
  let changed = true;
  while (changed) {
    changed = false;
    const next = text.trim();
    if (next.startsWith(HEARTBEAT_TOKEN)) {
      text = next.slice(HEARTBEAT_TOKEN.length).trimStart();
      didStrip = true;
      changed = true;
      continue;
    }
    if (next.endsWith(HEARTBEAT_TOKEN)) {
      text = next.slice(0, Math.max(0, next.length - HEARTBEAT_TOKEN.length)).trimEnd();
      didStrip = true;
      changed = true;
    }
  }

  return {
    text: text.replace(/\s+/g, " ").trim(),
    didStrip,
  };
}

export function stripHeartbeatToken(
  raw?: string,
  opts: { mode?: StripHeartbeatMode; maxAckChars?: number } = {},
): { shouldSkip: boolean; text: string; didStrip: boolean } {
  if (!raw) return { shouldSkip: true, text: "", didStrip: false };

  const trimmed = raw.trim();
  if (!trimmed) return { shouldSkip: true, text: "", didStrip: false };

  const mode = opts.mode ?? "message";
  const maxAckCharsRaw = opts.maxAckChars;
  const maxAckChars = Math.max(
    0,
    typeof maxAckCharsRaw === "number" && Number.isFinite(maxAckCharsRaw)
      ? maxAckCharsRaw
      : DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  );

  const stripMarkup = (text: string) =>
    text
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/^[*`~_]+/, "")
      .replace(/[*`~_]+$/, "");

  const normalized = stripMarkup(trimmed);
  const hasToken =
    trimmed.includes(HEARTBEAT_TOKEN) || normalized.includes(HEARTBEAT_TOKEN);
  if (!hasToken) {
    return { shouldSkip: false, text: trimmed, didStrip: false };
  }

  const strippedOriginal = stripTokenAtEdges(trimmed);
  const strippedNormalized = stripTokenAtEdges(normalized);
  const picked =
    strippedOriginal.didStrip && strippedOriginal.text
      ? strippedOriginal
      : strippedNormalized;

  if (!picked.didStrip) {
    return { shouldSkip: false, text: trimmed, didStrip: false };
  }

  if (!picked.text) {
    return { shouldSkip: true, text: "", didStrip: true };
  }

  const rest = picked.text.trim();
  if (mode === "heartbeat" && rest.length <= maxAckChars) {
    return { shouldSkip: true, text: "", didStrip: true };
  }

  return { shouldSkip: false, text: rest, didStrip: true };
}
