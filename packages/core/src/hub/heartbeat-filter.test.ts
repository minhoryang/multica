import { describe, expect, it } from "vitest";
import {
  extractAssistantEventText,
  isHeartbeatAckEvent,
} from "./heartbeat-filter.js";

describe("heartbeat-filter", () => {
  it("extracts text from string content", () => {
    const event = {
      message: {
        content: "  HEARTBEAT_OK  ",
      },
    };
    expect(extractAssistantEventText(event)).toBe("HEARTBEAT_OK");
  });

  it("extracts text from content blocks", () => {
    const event = {
      message: {
        content: [
          { type: "text", text: "line 1" },
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "line 2" },
        ],
      },
    };
    expect(extractAssistantEventText(event)).toBe("line 1 line 2");
  });

  it("treats pure heartbeat token as ack", () => {
    const event = {
      message: {
        content: [{ type: "text", text: "HEARTBEAT_OK" }],
      },
    };
    expect(isHeartbeatAckEvent(event)).toBe(true);
  });

  it("treats marked-up heartbeat token as ack", () => {
    const event = {
      message: {
        content: [{ type: "text", text: "**HEARTBEAT_OK**" }],
      },
    };
    expect(isHeartbeatAckEvent(event)).toBe(true);
  });

  it("does not suppress real alert text", () => {
    const event = {
      message: {
        content: [{ type: "text", text: "Reminder: go downstairs now." }],
      },
    };
    expect(isHeartbeatAckEvent(event)).toBe(false);
  });

  it("does not suppress token plus extra content", () => {
    const event = {
      message: {
        content: [{ type: "text", text: "HEARTBEAT_OK Reminder: check inbox." }],
      },
    };
    expect(isHeartbeatAckEvent(event)).toBe(false);
  });
});

