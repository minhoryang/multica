import type { RpcHandler } from "../dispatcher.js";

interface HubLike {
  createAgent(id?: string): { sessionId: string };
}

export function createCreateAgentHandler(hub: HubLike): RpcHandler {
  return (params: unknown) => {
    const { id } = (params ?? {}) as { id?: string };
    const agent = hub.createAgent(id);
    return { id: agent.sessionId };
  };
}
