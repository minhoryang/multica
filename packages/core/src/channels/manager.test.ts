import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hub } from "../hub/hub.js";
import type { AsyncAgent } from "../agent/async-agent.js";
import type { ChannelPlugin } from "./types.js";
import { ChannelManager } from "./manager.js";

type AgentEventCallback = (event: unknown) => void;

function createHarness() {
  let subscriber: AgentEventCallback | null = null;

  const agent = {
    sessionId: "agent-1",
    subscribe: (callback: AgentEventCallback) => {
      subscriber = callback;
      return () => {
        subscriber = null;
      };
    },
  } as unknown as AsyncAgent;

  const hub = {
    listAgents: () => ["agent-1"],
    getAgent: () => agent,
  } as unknown as Hub;

  const replyText = vi.fn(async () => {});
  const sendText = vi.fn(async () => {});
  const plugin: ChannelPlugin = {
    id: "telegram",
    meta: {
      name: "Telegram",
      description: "test",
    },
    config: {
      listAccountIds: () => [],
      resolveAccount: () => undefined,
      isConfigured: () => false,
    },
    gateway: {
      start: async () => {},
    },
    outbound: {
      replyText,
      sendText,
    },
  };

  const manager = new ChannelManager(hub);
  (manager as unknown as { lastRoute: unknown }).lastRoute = {
    plugin,
    deliveryCtx: {
      channel: "telegram",
      accountId: "default",
      conversationId: "chat-1",
      replyToMessageId: "in-1",
    },
  };
  (manager as unknown as { ensureSubscribed: () => void }).ensureSubscribed();

  const emit = (event: unknown) => subscriber?.(event);

  return { manager, replyText, sendText, emit };
}

describe("channel manager heartbeat filtering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses pure HEARTBEAT_OK in channel outbound", async () => {
    const { manager, replyText, sendText, emit } = createHarness();

    emit({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "HEARTBEAT_OK" }] },
    });

    await Promise.resolve();

    expect(replyText).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();

    manager.stopAll();
  });

  it("keeps forwarding normal assistant replies", async () => {
    const { manager, replyText, sendText, emit } = createHarness();

    emit({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Reminder: check inbox." }] },
    });

    await Promise.resolve();

    expect(replyText).toHaveBeenCalledTimes(1);
    expect(replyText).toHaveBeenCalledWith(
      {
        channel: "telegram",
        accountId: "default",
        conversationId: "chat-1",
        replyToMessageId: "in-1",
      },
      "Reminder: check inbox.",
    );
    expect(sendText).not.toHaveBeenCalled();

    manager.stopAll();
  });
});
