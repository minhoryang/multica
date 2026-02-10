/**
 * Cron Module
 *
 * Provides scheduled task functionality for Super Multica.
 */

export type {
  CronSchedule,
  CronSessionTarget,
  CronWakeMode,
  CronPayload,
  CronJobState,
  CronJob,
  CronJobInput,
  CronJobPatch,
  CronRunLogEntry,
  CronConfig,
} from "./types.js";

export {
  computeNextRunAtMs,
  isValidCronExpr,
  parseTimeInput,
  parseIntervalInput,
  formatSchedule,
  formatDuration,
} from "./schedule.js";

export { CronStore } from "./store.js";

export {
  CronService,
  getCronService,
  shutdownCronService,
  type CronJobExecutor,
  type CronServiceStatus,
} from "./service.js";

export { executeCronJob, type ExecutionResult } from "./execute.js";
