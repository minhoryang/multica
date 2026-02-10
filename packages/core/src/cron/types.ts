/**
 * Cron Job Types
 *
 * Based on OpenClaw's implementation (MIT License)
 */

/** Cron schedule: one-shot, interval, or cron expression */
export type CronSchedule =
  | { kind: "at"; atMs: number }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

/** Where to run the job */
export type CronSessionTarget = "main" | "isolated";

/** When to wake after job execution */
export type CronWakeMode = "next-heartbeat" | "now";

/** Job payload: what to execute */
export type CronPayload =
  | {
      kind: "system-event";
      /** Text to inject into main session */
      text: string;
    }
  | {
      kind: "agent-turn";
      /** Message/prompt for the agent */
      message: string;
      /** Optional model override (e.g., "anthropic/claude-3-opus") */
      model?: string;
      /** Optional thinking level override */
      thinkingLevel?: string;
      /** Timeout in seconds */
      timeoutSeconds?: number;
    };

/** Runtime state of a job */
export type CronJobState = {
  /** Next scheduled run (ms since epoch) */
  nextRunAtMs?: number | undefined;
  /** Currently running (lock marker, ms since epoch) */
  runningAtMs?: number | undefined;
  /** Last completed run (ms since epoch) */
  lastRunAtMs?: number | undefined;
  /** Last run status */
  lastStatus?: "ok" | "error" | "skipped" | undefined;
  /** Last error message */
  lastError?: string | undefined;
  /** Last run duration in ms */
  lastDurationMs?: number | undefined;
};

/** Cron job definition */
export type CronJob = {
  /** Unique identifier (UUIDv7) */
  id: string;
  /** User-friendly name */
  name: string;
  /** Optional description */
  description?: string;
  /** Whether the job is enabled */
  enabled: boolean;
  /** Delete after successful one-shot run */
  deleteAfterRun?: boolean;
  /** Creation timestamp (ms) */
  createdAtMs: number;
  /** Last update timestamp (ms) */
  updatedAtMs: number;
  /** When to run */
  schedule: CronSchedule;
  /** Where to run (main session or isolated) */
  sessionTarget: CronSessionTarget;
  /** Wake mode after execution */
  wakeMode: CronWakeMode;
  /** What to execute */
  payload: CronPayload;
  /** Runtime state */
  state: CronJobState;
};

/** Input for creating a new job (without auto-generated fields) */
export type CronJobInput = Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs" | "state">;

/** Input for updating an existing job */
export type CronJobPatch = Partial<Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs">>;

/** Run log entry */
export type CronRunLogEntry = {
  /** Timestamp (ms) */
  ts: number;
  /** Job ID */
  jobId: string;
  /** Action taken */
  action: "run" | "skip" | "error";
  /** Result status */
  status: "ok" | "error" | "skipped";
  /** Error message if failed */
  error?: string | undefined;
  /** Summary of execution (for agent-turn) */
  summary?: string | undefined;
  /** Duration in ms */
  durationMs?: number | undefined;
  /** Next scheduled run */
  nextRunAtMs?: number | undefined;
};

/** Cron service configuration */
export type CronConfig = {
  /** Whether cron is enabled (default: true) */
  enabled?: boolean;
  /** Custom store path */
  storePath?: string;
  /** Max concurrent job runs (default: 1) */
  maxConcurrentRuns?: number;
};
