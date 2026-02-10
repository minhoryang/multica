import type { RpcHandler } from "../dispatcher.js";

interface HubLike {
  getLastHeartbeat(): unknown;
}

export function createGetLastHeartbeatHandler(hub: HubLike): RpcHandler {
  return () => hub.getLastHeartbeat();
}
