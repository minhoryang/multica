/**
 * Cron Service
 *
 * Manages scheduled jobs with timer-based execution.
 * Based on OpenClaw's implementation (MIT License)
 */

import { v7 as uuidv7 } from "uuid";
import type {
  CronJob,
  CronJobInput,
  CronJobPatch,
  CronJobState,
  CronRunLogEntry,
  CronConfig,
} from "./types.js";
import { CronStore } from "./store.js";
import { computeNextRunAtMs } from "./schedule.js";

/** Callback for job execution */
export type CronJobExecutor = (job: CronJob) => Promise<{ summary?: string; error?: string }>;

/** Service status */
export type CronServiceStatus = {
  running: boolean;
  enabled: boolean;
  storePath: string;
  jobCount: number;
  enabledJobCount: number;
  nextWakeAtMs: number | null;
};

/** Default stuck job timeout (2 hours) */
const STUCK_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export class CronService {
  private readonly store: CronStore;
  private readonly config: CronConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private executor: CronJobExecutor | null = null;

  constructor(config: CronConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxConcurrentRuns: config.maxConcurrentRuns ?? 1,
      ...config,
    };
    this.store = new CronStore(config.storePath);
  }

  /**
   * Set the job executor callback.
   * This is called when a job needs to be executed.
   */
  setExecutor(executor: CronJobExecutor): void {
    this.executor = executor;
  }

  /**
   * Start the cron service.
   * Loads jobs from disk, computes schedules, and starts the timer.
   */
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.config.enabled) {
      console.log("[CronService] Cron is disabled by config");
      return;
    }

    this.running = true;
    console.log("[CronService] Starting...");

    // Load jobs and compute next run times
    const jobs = this.store.load();
    console.log(`[CronService] Loaded ${jobs.length} jobs`);

    // Recompute all schedules
    this.recomputeAllSchedules();

    // Clear any stuck jobs (running for > 2 hours)
    this.clearStuckJobs();

    // Arm timer for next job
    this.armTimer();

    console.log("[CronService] Started");
  }

  /**
   * Stop the cron service.
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    console.log("[CronService] Stopped");
  }

  /**
   * Get service status.
   */
  status(): CronServiceStatus {
    const allJobs = this.store.list();
    const enabledJobs = this.store.list({ enabled: true });

    const nextWake = enabledJobs.reduce((min, job) => {
      const next = job.state.nextRunAtMs;
      return next !== undefined && next < min ? next : min;
    }, Infinity);

    return {
      running: this.running,
      enabled: this.config.enabled ?? true,
      storePath: this.store.getStorePath(),
      jobCount: allJobs.length,
      enabledJobCount: enabledJobs.length,
      nextWakeAtMs: nextWake === Infinity ? null : nextWake,
    };
  }

  /**
   * List jobs with optional filter.
   */
  list(filter?: { enabled?: boolean }): CronJob[] {
    return this.store.list(filter);
  }

  /**
   * Get a job by ID.
   */
  get(id: string): CronJob | undefined {
    return this.store.get(id);
  }

  /**
   * Add a new job.
   */
  add(input: CronJobInput): CronJob {
    const now = Date.now();
    const job: CronJob = {
      ...input,
      id: uuidv7(),
      createdAtMs: now,
      updatedAtMs: now,
      state: {},
    };

    // Compute initial next run time
    this.computeNextRun(job);

    this.store.set(job);
    console.log(`[CronService] Added job: ${job.name} (${job.id}), next run: ${job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : "none"}`);

    // Re-arm timer in case this job runs sooner
    if (this.running) {
      this.armTimer();
    }

    return job;
  }

  /**
   * Update an existing job.
   */
  update(id: string, patch: CronJobPatch): CronJob | null {
    const job = this.store.get(id);
    if (!job) return null;

    // Apply patch
    Object.assign(job, patch, { updatedAtMs: Date.now() });

    // Recompute schedule if changed
    if (patch.schedule || patch.enabled !== undefined) {
      this.computeNextRun(job);
    }

    this.store.set(job);
    console.log(`[CronService] Updated job: ${job.name} (${job.id})`);

    // Re-arm timer
    if (this.running) {
      this.armTimer();
    }

    return job;
  }

  /**
   * Remove a job.
   */
  remove(id: string): boolean {
    const job = this.store.get(id);
    if (!job) return false;

    const deleted = this.store.delete(id);
    if (deleted) {
      console.log(`[CronService] Removed job: ${job.name} (${id})`);
    }

    return deleted;
  }

  /**
   * Run a job immediately.
   *
   * @param id - Job ID
   * @param force - Run even if disabled
   */
  async run(id: string, force = false): Promise<{ ok: boolean; reason?: string }> {
    const job = this.store.get(id);
    if (!job) {
      return { ok: false, reason: "Job not found" };
    }

    if (!job.enabled && !force) {
      return { ok: false, reason: "Job is disabled" };
    }

    if (job.state.runningAtMs) {
      return { ok: false, reason: "Job is already running" };
    }

    await this.executeJob(job);
    return { ok: true };
  }

  /**
   * Get run logs for a job.
   */
  getRunLogs(id: string, limit?: number): CronRunLogEntry[] {
    return this.store.getRunLogs(id, limit);
  }

  // === Private Methods ===

  /**
   * Compute next run time for a job.
   */
  private computeNextRun(job: CronJob): void {
    if (!job.enabled) {
      job.state.nextRunAtMs = undefined;
      return;
    }

    const now = Date.now();
    const nextMs = computeNextRunAtMs(job.schedule, now);
    job.state.nextRunAtMs = nextMs;
  }

  /**
   * Recompute schedules for all enabled jobs.
   */
  private recomputeAllSchedules(): void {
    for (const job of this.store.list({ enabled: true })) {
      this.computeNextRun(job);
      this.store.set(job);
    }
  }

  /**
   * Clear stuck jobs (running for too long).
   */
  private clearStuckJobs(): void {
    const now = Date.now();
    for (const job of this.store.list()) {
      if (job.state.runningAtMs && now - job.state.runningAtMs > STUCK_JOB_TIMEOUT_MS) {
        console.warn(`[CronService] Clearing stuck job: ${job.name} (${job.id})`);
        job.state.runningAtMs = undefined;
        job.state.lastStatus = "error";
        job.state.lastError = "Job was stuck (running > 2 hours)";
        this.store.set(job);
      }
    }
  }

  /**
   * Arm the timer for the next due job.
   */
  private armTimer(): void {
    if (!this.running) return;

    // Clear existing timer
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Find next wake time
    const enabledJobs = this.store.list({ enabled: true });
    const nextWake = enabledJobs.reduce((min, job) => {
      const next = job.state.nextRunAtMs;
      return next !== undefined && next < min ? next : min;
    }, Infinity);

    if (nextWake === Infinity) {
      // No jobs to run
      return;
    }

    const delay = Math.max(0, nextWake - Date.now());
    this.timer = setTimeout(() => this.onTimer(), delay);
  }

  /**
   * Timer callback: run all due jobs.
   */
  private async onTimer(): Promise<void> {
    if (!this.running) return;

    const now = Date.now();
    const dueJobs = this.store
      .list({ enabled: true })
      .filter((j) => {
        const next = j.state.nextRunAtMs;
        return next !== undefined && next <= now && !j.state.runningAtMs;
      });

    for (const job of dueJobs) {
      try {
        await this.executeJob(job);
      } catch (error) {
        console.error(`[CronService] Error executing job ${job.id}:`, error);
      }
    }

    // Re-arm timer for next batch
    this.armTimer();
  }

  /**
   * Execute a single job.
   */
  private async executeJob(job: CronJob): Promise<void> {
    const startMs = Date.now();
    console.log(`[CronService] Executing job: ${job.name} (${job.id})`);

    // Mark as running
    job.state.runningAtMs = startMs;
    this.store.set(job);

    let status: "ok" | "error" = "ok";
    let error: string | undefined;
    let summary: string | undefined;

    try {
      if (this.executor) {
        const result = await this.executor(job);
        summary = result.summary;
        if (result.error) {
          status = "error";
          error = result.error;
        }
      } else {
        // No executor set, just log
        console.log(`[CronService] Job ${job.id} payload:`, job.payload);
      }
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
      console.error(`[CronService] Job ${job.id} failed:`, err);
    }

    const durationMs = Date.now() - startMs;

    // Update job state
    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = startMs;
    job.state.lastStatus = status;
    job.state.lastError = error;
    job.state.lastDurationMs = durationMs;

    // Handle one-shot jobs
    if (job.schedule.kind === "at") {
      if (status === "ok" && job.deleteAfterRun) {
        this.store.delete(job.id);
        console.log(`[CronService] Deleted one-shot job: ${job.name} (${job.id})`);
      } else {
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
        this.store.set(job);
      }
    } else {
      // Compute next run for recurring jobs
      this.computeNextRun(job);
      this.store.set(job);
    }

    // Append run log
    this.store.appendRunLog(job.id, {
      ts: startMs,
      jobId: job.id,
      action: status === "ok" ? "run" : "error",
      status,
      error,
      summary,
      durationMs,
      nextRunAtMs: job.state.nextRunAtMs,
    });

    console.log(`[CronService] Job ${job.id} completed: ${status} (${durationMs}ms)`);
  }
}

// === Singleton ===

let cronServiceInstance: CronService | null = null;

/**
 * Get or create the singleton CronService instance.
 */
export function getCronService(config?: CronConfig): CronService {
  if (!cronServiceInstance) {
    cronServiceInstance = new CronService(config);
  }
  return cronServiceInstance;
}

/**
 * Shutdown the singleton CronService.
 */
export function shutdownCronService(): void {
  if (cronServiceInstance) {
    cronServiceInstance.stop();
    cronServiceInstance = null;
  }
}
