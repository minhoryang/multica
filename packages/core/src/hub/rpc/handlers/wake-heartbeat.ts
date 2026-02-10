import type { RpcHandler } from "../dispatcher.js";

interface HubLike {
  requestHeartbeatNow(opts?: { reason?: string }): void;
}

export function createWakeHeartbeatHandler(hub: HubLike): RpcHandler {
  return (params) => {
    const reasonRaw = (params as { reason?: unknown } | undefined)?.reason;
    const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
    hub.requestHeartbeatNow({ reason: reason || "manual" });
    return { ok: true };
  };
}
