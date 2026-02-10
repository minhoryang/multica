/**
 * Cron IPC handlers for Electron main process.
 *
 * These handlers expose CronService operations to the renderer process
 * for the Cron Jobs management page.
 */
import { ipcMain } from 'electron'
import { getCronService, formatSchedule } from '@multica/core'

/**
 * Register all Cron-related IPC handlers.
 */
export function registerCronIpcHandlers(): void {
  /**
   * List all cron jobs with formatted display fields.
   */
  ipcMain.handle('cron:list', async () => {
    const service = getCronService()
    const jobs = service.list()

    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      description: job.description,
      enabled: job.enabled,
      schedule: formatSchedule(job.schedule),
      sessionTarget: job.sessionTarget,
      nextRunAt: job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : null,
      lastStatus: job.state.lastStatus ?? null,
      lastRunAt: job.state.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : null,
      lastDurationMs: job.state.lastDurationMs ?? null,
      lastError: job.state.lastError ?? null,
    }))
  })

  /**
   * Toggle a cron job's enabled status.
   */
  ipcMain.handle('cron:toggle', async (_event, jobId: string) => {
    const service = getCronService()
    const job = service.get(jobId)
    if (!job) {
      return { error: `Job not found: ${jobId}` }
    }

    const updated = service.update(jobId, { enabled: !job.enabled })
    if (!updated) {
      return { error: `Failed to update job: ${jobId}` }
    }

    return {
      id: updated.id,
      enabled: updated.enabled,
    }
  })

  /**
   * Remove a cron job.
   */
  ipcMain.handle('cron:remove', async (_event, jobId: string) => {
    const service = getCronService()
    const removed = service.remove(jobId)
    if (!removed) {
      return { error: `Job not found: ${jobId}` }
    }
    return { ok: true }
  })
}
