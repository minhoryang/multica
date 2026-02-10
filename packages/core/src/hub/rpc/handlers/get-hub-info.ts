import type { RpcHandler } from "../dispatcher.js";

interface HubLike {
  hubId: string;
  url: string;
  connectionState: string;
  listAgents(): string[];
}

export function createGetHubInfoHandler(hub: HubLike): RpcHandler {
  return () => ({
    hubId: hub.hubId,
    url: hub.url,
    connectionState: hub.connectionState,
    agentCount: hub.listAgents().length,
  });
}
