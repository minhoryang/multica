/**
 * Heartbeat IPC handlers for Electron main process.
 */
import { ipcMain } from "electron";
import { getCurrentHub } from "./hub.js";

export function registerHeartbeatIpcHandlers(): void {
  ipcMain.handle("heartbeat:last", async () => {
    const hub = getCurrentHub();
    if (!hub) return null;
    return hub.getLastHeartbeat();
  });

  ipcMain.handle("heartbeat:setEnabled", async (_event, enabled: boolean) => {
    const hub = getCurrentHub();
    if (!hub) {
      return { ok: false, error: "Hub not initialized" };
    }
    if (typeof enabled !== "boolean") {
      return { ok: false, error: "enabled must be boolean" };
    }

    hub.setHeartbeatsEnabled(enabled);
    return { ok: true, enabled };
  });

  ipcMain.handle("heartbeat:wake", async (_event, reason?: string) => {
    const hub = getCurrentHub();
    if (!hub) {
      return { ok: false, error: "Hub not initialized" };
    }

    const result = await hub.runHeartbeatOnce({
      reason: typeof reason === "string" ? reason.trim() || "manual" : "manual",
    });

    return { ok: result.status !== "failed", result };
  });
}
