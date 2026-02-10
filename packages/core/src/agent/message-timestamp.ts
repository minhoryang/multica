/**
 * Message timestamp injection for time awareness.
 *
 * Keeps system prompt stable while giving the model a reliable "now"
 * reference in each incoming user turn.
 */

const CRON_TIME_PATTERN = /Current time:\s/;
const TIMESTAMP_ENVELOPE_PATTERN = /^\[.*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;

export interface MessageTimestampOptions {
  timeZone?: string;
  now?: Date;
}

export function resolveMessageTimezone(configured?: string): string {
  const fromArg = configured?.trim();
  if (fromArg && isValidTimezone(fromArg)) {
    return fromArg;
  }

  const fromEnv = process.env.TZ?.trim();
  if (fromEnv && isValidTimezone(fromEnv)) {
    return fromEnv;
  }

  const hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return hostTimezone?.trim() || "UTC";
}

function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatZonedTimestamp(date: Date, timeZone: string): string | undefined {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(date);

  const pick = (type: string) => parts.find((part) => part.type === type)?.value;
  const yyyy = pick("year");
  const mm = pick("month");
  const dd = pick("day");
  const hh = pick("hour");
  const min = pick("minute");
  const tz = [...parts]
    .reverse()
    .find((part) => part.type === "timeZoneName")
    ?.value?.trim();

  if (!yyyy || !mm || !dd || !hh || !min) {
    return undefined;
  }

  return `${yyyy}-${mm}-${dd} ${hh}:${min}${tz ? ` ${tz}` : ""}`;
}

export function injectMessageTimestamp(
  message: string,
  opts?: MessageTimestampOptions,
): string {
  if (!message.trim()) {
    return message;
  }

  if (TIMESTAMP_ENVELOPE_PATTERN.test(message)) {
    return message;
  }

  if (CRON_TIME_PATTERN.test(message)) {
    return message;
  }

  const now = opts?.now ?? new Date();
  const timeZone = resolveMessageTimezone(opts?.timeZone);
  const formatted = formatZonedTimestamp(now, timeZone);

  if (!formatted) {
    return message;
  }

  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(now);

  return `[${dow} ${formatted}] ${message}`;
}
