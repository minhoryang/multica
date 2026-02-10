export type SystemEvent = { text: string; ts: number };

const MAX_EVENTS = 20;
const queues = new Map<string, SystemEvent[]>();

function normalizeSessionKey(key: string | undefined): string {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) {
    throw new Error("system events require a sessionKey");
  }
  return trimmed;
}

export function enqueueSystemEvent(text: string, opts: { sessionKey: string }): void {
  const sessionKey = normalizeSessionKey(opts.sessionKey);
  const cleaned = text.trim();
  if (!cleaned) return;

  const list = queues.get(sessionKey) ?? [];
  const previous = list[list.length - 1];
  if (previous?.text === cleaned) {
    return;
  }

  list.push({ text: cleaned, ts: Date.now() });
  if (list.length > MAX_EVENTS) {
    list.splice(0, list.length - MAX_EVENTS);
  }
  queues.set(sessionKey, list);
}

export function drainSystemEvents(sessionKey: string): string[] {
  const key = normalizeSessionKey(sessionKey);
  const list = queues.get(key) ?? [];
  queues.delete(key);
  return list.map((entry) => entry.text);
}

export function peekSystemEvents(sessionKey: string): string[] {
  const key = normalizeSessionKey(sessionKey);
  return (queues.get(key) ?? []).map((entry) => entry.text);
}

export function hasSystemEvents(sessionKey: string): boolean {
  const key = normalizeSessionKey(sessionKey);
  return (queues.get(key)?.length ?? 0) > 0;
}

export function resetSystemEventsForTest(): void {
  queues.clear();
}
