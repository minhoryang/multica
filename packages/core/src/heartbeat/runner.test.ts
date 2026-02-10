import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { runHeartbeatOnce, setHeartbeatsEnabled } from "./runner.js";

type StubAgent = {
  closed: boolean;
  sessionId: string;
  ensureInitialized: () => Promise<void>;
  getMessages: () => Array<any>;
  write: (content: string, options?: { injectTimestamp?: boolean }) => void;
  waitForIdle: () => Promise<void>;
  getHeartbeatConfig: () => { prompt?: string; ackMaxChars?: number; enabled?: boolean };
  getPendingWrites: () => number;
  getProfileDir: () => string | undefined;
};

function createStubAgent(opts?: {
  profileDir?: string;
  replyText?: string;
  heartbeatEnabled?: boolean;
}): StubAgent {
  const messages: Array<any> = [];
  const replyText = opts?.replyText ?? "HEARTBEAT_OK";

  return {
    closed: false,
    sessionId: "test-session",
    ensureInitialized: async () => {},
    getMessages: () => messages,
    write: (content: string) => {
      messages.push({ role: "user", content });
      messages.push({ role: "assistant", content: [{ type: "text", text: replyText }] });
    },
    waitForIdle: async () => {},
    getHeartbeatConfig: () =>
      typeof opts?.heartbeatEnabled === "boolean"
        ? { enabled: opts.heartbeatEnabled }
        : {},
    getPendingWrites: () => 0,
    getProfileDir: () => opts?.profileDir,
  };
}

describe("heartbeat runner", () => {
  afterEach(() => {
    setHeartbeatsEnabled(true);
  });

  it("skips when no agent is available", async () => {
    const result = await runHeartbeatOnce({ agent: null });
    expect(result).toEqual({ status: "skipped", reason: "disabled" });
  });

  it("skips when heartbeat file is effectively empty", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "heartbeat-test-"));
    try {
      await writeFile(path.join(dir, "heartbeat.md"), "# keep empty\n", "utf-8");
      const agent = createStubAgent({ profileDir: dir });
      const result = await runHeartbeatOnce({ agent: agent as any });
      expect(result).toEqual({ status: "skipped", reason: "empty-heartbeat-file" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bypasses empty-heartbeat-file check for cron-triggered wakes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "heartbeat-test-"));
    try {
      await writeFile(path.join(dir, "heartbeat.md"), "# keep empty\n", "utf-8");
      const agent = createStubAgent({ profileDir: dir, replyText: "HEARTBEAT_OK" });
      const result = await runHeartbeatOnce({ agent: agent as any, reason: "cron:test-job-id" });
      expect(result.status).toBe("ran");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs and returns ran for heartbeat acknowledgements", async () => {
    const agent = createStubAgent({ replyText: "HEARTBEAT_OK" });
    const result = await runHeartbeatOnce({ agent: agent as any, reason: "manual" });

    expect(result.status).toBe("ran");
  });

  it("disables timestamp injection for heartbeat prompt writes", async () => {
    const writes: Array<{ content: string; options?: { injectTimestamp?: boolean } }> = [];
    const agent = createStubAgent({ replyText: "HEARTBEAT_OK" });
    const originalWrite = agent.write;
    agent.write = (content, options) => {
      writes.push(options ? { content, options } : { content });
      originalWrite(content, options);
    };

    await runHeartbeatOnce({ agent: agent as any, reason: "manual" });

    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0]?.options?.injectTimestamp).toBe(false);
  });
});
