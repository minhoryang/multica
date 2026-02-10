import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasPendingHeartbeatWake,
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
} from "./heartbeat-wake.js";

describe("heartbeat-wake", () => {
  afterEach(() => {
    setHeartbeatWakeHandler(null);
    vi.useRealTimers();
  });

  it("coalesces multiple wake requests into one run", async () => {
    vi.useFakeTimers();
    const handler = vi.fn(async () => ({ status: "ran" as const, durationMs: 1 }));

    setHeartbeatWakeHandler(handler);
    requestHeartbeatNow({ reason: "a" });
    requestHeartbeatNow({ reason: "b" });
    requestHeartbeatNow({ reason: "c" });

    expect(hasPendingHeartbeatWake()).toBe(true);

    await vi.advanceTimersByTimeAsync(300);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries when requests are in flight", async () => {
    vi.useFakeTimers();

    const handler = vi
      .fn()
      .mockResolvedValueOnce({ status: "skipped" as const, reason: "requests-in-flight" })
      .mockResolvedValueOnce({ status: "ran" as const, durationMs: 3 });

    setHeartbeatWakeHandler(handler);
    requestHeartbeatNow({ reason: "retry-case" });

    await vi.advanceTimersByTimeAsync(300);
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1100);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
