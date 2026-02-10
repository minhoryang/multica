import type { RpcHandler } from "../dispatcher.js";

interface HubLike {
  listAgents(): string[];
  getAgent(id: string): { closed: boolean } | undefined;
}

export function createListAgentsHandler(hub: HubLike): RpcHandler {
  return () => {
    const agents = hub.listAgents().map((id) => {
      const agent = hub.getAgent(id);
      return { id, closed: agent?.closed ?? true };
    });
    return { agents };
  };
}
