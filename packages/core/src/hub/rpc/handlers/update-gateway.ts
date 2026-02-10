import { RpcError, type RpcHandler } from "../dispatcher.js";

interface HubLike {
  url: string;
  connectionState: string;
  reconnect(url: string): void;
}

export function createUpdateGatewayHandler(hub: HubLike): RpcHandler {
  return (params: unknown) => {
    if (!params || typeof params !== "object") {
      throw new RpcError("INVALID_PARAMS", "params must be an object");
    }
    const { url } = params as { url?: string };
    if (!url) {
      throw new RpcError("INVALID_PARAMS", "Missing required param: url");
    }
    hub.reconnect(url);
    return { url: hub.url, connectionState: hub.connectionState };
  };
}
