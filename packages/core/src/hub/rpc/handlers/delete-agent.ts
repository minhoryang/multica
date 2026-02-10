import { RpcError, type RpcHandler } from "../dispatcher.js";

interface HubLike {
  closeAgent(id: string): boolean;
}

export function createDeleteAgentHandler(hub: HubLike): RpcHandler {
  return (params: unknown) => {
    if (!params || typeof params !== "object") {
      throw new RpcError("INVALID_PARAMS", "params must be an object");
    }
    const { id } = params as { id?: string };
    if (!id) {
      throw new RpcError("INVALID_PARAMS", "Missing required param: id");
    }
    const ok = hub.closeAgent(id);
    return { ok };
  };
}
