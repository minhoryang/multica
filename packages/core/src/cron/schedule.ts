/**
 * Cron Schedule Computation
 *
 * Based on OpenClaw's implementation (MIT License)
 */

import { Cron } from "croner";
import type { CronSchedule } from "./types.js";

/**
 * Compute the next run time for a schedule.
 *
 * @param schedule - The schedule configuration
 * @param nowMs - Current time in milliseconds (default: Date.now())
 * @returns Next run time in ms, or undefined if no future run
 */
export function computeNextRunAtMs(
  schedule: CronSchedule,
  nowMs: number = Date.now(),
): number | undefined {
  switch (schedule.kind) {
    case "at":
      // One-shot: return the timestamp if it's in the future
      return schedule.atMs > nowMs ? schedule.atMs : undefined;

    case "every": {
      // Fixed interval: compute next occurrence
      const everyMs = Math.max(1, Math.floor(schedule.everyMs));
      const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));

      if (nowMs < anchor) return anchor;

      const elapsed = nowMs - anchor;
      const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
      return anchor + steps * everyMs;
    }

    case "cron": {
      // Cron expression: use croner to compute next run
      const expr = schedule.expr.trim();
      if (!expr) return undefined;

      try {
        const tz = schedule.tz?.trim();
        const cron = tz ? new Cron(expr, { timezone: tz }) : new Cron(expr);
        const next = cron.nextRun(new Date(nowMs));
        return next ? next.getTime() : undefined;
      } catch (error) {
        console.error(`[Cron] Invalid cron expression: ${expr}`, error);
        return undefined;
      }
    }
  }
}

/**
 * Validate a cron expression.
 *
 * @param expr - Cron expression (5-field)
 * @param tz - Optional timezone
 * @returns true if valid, false otherwise
 */
export function isValidCronExpr(expr: string, tz?: string): boolean {
  try {
    const timezone = tz?.trim();
    if (timezone) {
      new Cron(expr.trim(), { timezone });
    } else {
      new Cron(expr.trim());
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a human-readable time string into milliseconds.
 *
 * Supports:
 * - Relative: "10s", "5m", "2h", "1d"
 * - ISO 8601: "2024-01-15T09:00:00Z"
 * - Unix timestamp (if numeric)
 *
 * @param input - Time string
 * @param nowMs - Current time for relative calculations
 * @returns Timestamp in ms, or undefined if invalid
 */
export function parseTimeInput(input: string, nowMs: number = Date.now()): number | undefined {
  const trimmed = input.trim();

  // Check for relative time (e.g., "10m", "2h")
  const relativeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (relativeMatch) {
    const [, numStr, unit] = relativeMatch;
    const num = parseFloat(numStr!);
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    const ms = multipliers[unit!.toLowerCase()];
    if (ms !== undefined) {
      return nowMs + num * ms;
    }
  }

  // Check for numeric (unix timestamp in ms or seconds)
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    // If it looks like seconds (before year 2100), convert to ms
    if (num < 4102444800) {
      return num * 1000;
    }
    return num;
  }

  // Try ISO 8601 date parsing
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  return undefined;
}

/**
 * Parse an interval string into milliseconds.
 *
 * Supports: "30s", "5m", "2h", "1d", or raw milliseconds
 *
 * @param input - Interval string
 * @returns Interval in ms, or undefined if invalid
 */
export function parseIntervalInput(input: string): number | undefined {
  const trimmed = input.trim();

  // Check for duration format (e.g., "30m", "2h")
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (match) {
    const [, numStr, unit] = match;
    const num = parseFloat(numStr!);
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    const ms = multipliers[unit!.toLowerCase()];
    if (ms !== undefined) {
      return num * ms;
    }
  }

  // Check for raw milliseconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  return undefined;
}

/**
 * Format a schedule for display.
 */
export function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case "at":
      return `at ${new Date(schedule.atMs).toISOString()}`;
    case "every":
      return `every ${formatDuration(schedule.everyMs)}`;
    case "cron":
      return `cron "${schedule.expr}"${schedule.tz ? ` (${schedule.tz})` : ""}`;
  }
}

/**
 * Format milliseconds as human-readable duration.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60 * 1000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / (60 * 60 * 1000))}h`;
  return `${Math.round(ms / (24 * 60 * 60 * 1000))}d`;
}
