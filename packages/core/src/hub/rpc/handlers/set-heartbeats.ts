import type { RpcHandler } from "../dispatcher.js";
import { RpcError } from "../dispatcher.js";

interface HubLike {
  setHeartbeatsEnabled(enabled: boolean): void;
}

export function createSetHeartbeatsHandler(hub: HubLike): RpcHandler {
  return (params) => {
    const enabled = (params as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== "boolean") {
      throw new RpcError("INVALID_REQUEST", "enabled (boolean) is required");
    }

    hub.setHeartbeatsEnabled(enabled);
    return { ok: true, enabled };
  };
}
