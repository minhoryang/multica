import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectMessageTimestamp, resolveMessageTimezone } from "./message-timestamp.js";

describe("injectMessageTimestamp", () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-29T01:30:00.000Z"));
    process.env.TZ = "America/New_York";
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
  });

  it("prepends a compact timestamp prefix", () => {
    const result = injectMessageTimestamp("Is it the weekend?");
    expect(result).toMatch(/^\[Wed 2026-01-28 20:30 EST\] Is it the weekend\?$/);
  });

  it("does not double-stamp already enveloped messages", () => {
    const existing = "[Wed 2026-01-28 20:30 EST] hello";
    expect(injectMessageTimestamp(existing)).toBe(existing);
  });

  it("does not stamp cron messages that already include current time lines", () => {
    const existing = "Cron run\nCurrent time: Wednesday, January 28th, 2026 — 8:30 PM (America/New_York)";
    expect(injectMessageTimestamp(existing)).toBe(existing);
  });

  it("returns empty/whitespace input unchanged", () => {
    expect(injectMessageTimestamp("")).toBe("");
    expect(injectMessageTimestamp("   ")).toBe("   ");
  });
});

describe("resolveMessageTimezone", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("prefers explicit argument when valid", () => {
    process.env.TZ = "UTC";
    expect(resolveMessageTimezone("America/Chicago")).toBe("America/Chicago");
  });

  it("falls back to UTC for invalid values", () => {
    process.env.TZ = "Invalid/Timezone";
    const resolved = resolveMessageTimezone("also/invalid");
    expect(resolved).not.toBe("Invalid/Timezone");
    expect(resolved.length).toBeGreaterThan(0);
  });
});
