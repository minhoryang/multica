import { describe, it, expect, vi, beforeEach } from "vitest";

const readEntriesMock = vi.fn();

vi.mock("../session/storage.js", () => ({
  readEntries: (sessionId: string) => readEntriesMock(sessionId),
}));

import { readLatestAssistantReply } from "./announce.js";

describe("readLatestAssistantReply", () => {
  beforeEach(() => {
    readEntriesMock.mockReset();
  });

  it("returns the latest non-empty assistant text when the last assistant message is tool-only", () => {
    readEntriesMock.mockReturnValue([
      {
        type: "message",
        timestamp: 1,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "南京天气：晴，12°C。" }],
        },
      },
      {
        type: "message",
        timestamp: 2,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "weather", arguments: { city: "Nanjing" } }],
        },
      },
    ]);

    const result = readLatestAssistantReply("child-session");
    expect(result).toBe("南京天气：晴，12°C。");
  });

  it("falls back to latest toolResult text when no assistant text exists", () => {
    readEntriesMock.mockReturnValue([
      {
        type: "message",
        timestamp: 1,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-2", name: "weather", arguments: { city: "Nanjing" } }],
        },
      },
      {
        type: "message",
        timestamp: 2,
        message: {
          role: "toolResult",
          toolCallId: "tool-2",
          toolName: "weather",
          content: [{ type: "text", text: "{\"city\":\"Nanjing\",\"tempC\":12,\"condition\":\"Sunny\"}" }],
          isError: false,
        },
      },
    ]);

    const result = readLatestAssistantReply("child-session");
    expect(result).toContain("\"city\":\"Nanjing\"");
    expect(result).toContain("\"condition\":\"Sunny\"");
  });
});
