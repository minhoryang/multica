import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_TOKEN,
  isHeartbeatContentEffectivelyEmpty,
  stripHeartbeatToken,
} from "./heartbeat-text.js";

describe("heartbeat-text", () => {
  it("treats comment-only heartbeat files as empty", () => {
    expect(isHeartbeatContentEffectivelyEmpty("# title\n\n- [ ]\n")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("\n# note\n")).toBe(true);
    expect(isHeartbeatContentEffectivelyEmpty("check disk health")).toBe(false);
  });

  it("strips plain token responses", () => {
    const result = stripHeartbeatToken(HEARTBEAT_TOKEN, { mode: "heartbeat" });
    expect(result.shouldSkip).toBe(true);
    expect(result.text).toBe("");
  });

  it("keeps substantial content around token in heartbeat mode", () => {
    const longTail = "Potential issue detected: disk usage is 92% on /Users";
    const result = stripHeartbeatToken(`${HEARTBEAT_TOKEN} ${longTail}`, {
      mode: "heartbeat",
      maxAckChars: 10,
    });

    expect(result.shouldSkip).toBe(false);
    expect(result.text).toContain("disk usage");
  });
});
