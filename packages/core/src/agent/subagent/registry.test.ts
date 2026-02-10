import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerSubagentRun,
  listSubagentRuns,
  getSubagentRun,
  releaseSubagentRun,
  resetSubagentRegistryForTests,
  shutdownSubagentRegistry,
} from "./registry.js";

// Note: These tests exercise the registry's in-memory state management.
// They do NOT test the full lifecycle (which requires a live Hub + AsyncAgent).

beforeEach(() => {
  resetSubagentRegistryForTests();
});

describe("subagent registry", () => {
  it("registers a run and retrieves it by ID", () => {
    const record = registerSubagentRun({
      runId: "run-1",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Analyze code",
      label: "Code Analysis",
    });

    expect(record.runId).toBe("run-1");
    expect(record.childSessionId).toBe("child-1");
    expect(record.requesterSessionId).toBe("parent-1");
    expect(record.task).toBe("Analyze code");
    expect(record.label).toBe("Code Analysis");
    expect(record.cleanup).toBe("delete"); // default
    expect(record.createdAt).toBeGreaterThan(0);
    expect(record.startedAt).toBeGreaterThan(0); // set by watchChildAgent

    const retrieved = getSubagentRun("run-1");
    expect(retrieved).toBe(record);
  });

  it("lists runs filtered by requester session", () => {
    registerSubagentRun({
      runId: "run-1",
      childSessionId: "child-1",
      requesterSessionId: "parent-A",
      task: "Task 1",
    });
    registerSubagentRun({
      runId: "run-2",
      childSessionId: "child-2",
      requesterSessionId: "parent-B",
      task: "Task 2",
    });
    registerSubagentRun({
      runId: "run-3",
      childSessionId: "child-3",
      requesterSessionId: "parent-A",
      task: "Task 3",
    });

    const parentARuns = listSubagentRuns("parent-A");
    expect(parentARuns).toHaveLength(2);
    expect(parentARuns.map((r) => r.runId).sort()).toEqual(["run-1", "run-3"]);

    const parentBRuns = listSubagentRuns("parent-B");
    expect(parentBRuns).toHaveLength(1);
    expect(parentBRuns[0]!.runId).toBe("run-2");

    const emptyRuns = listSubagentRuns("parent-C");
    expect(emptyRuns).toHaveLength(0);
  });

  it("releases a run from the registry", () => {
    registerSubagentRun({
      runId: "run-1",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Task",
    });

    expect(getSubagentRun("run-1")).toBeDefined();

    const released = releaseSubagentRun("run-1");
    expect(released).toBe(true);
    expect(getSubagentRun("run-1")).toBeUndefined();

    // Double release returns false
    const releasedAgain = releaseSubagentRun("run-1");
    expect(releasedAgain).toBe(false);
  });

  it("applies custom cleanup value", () => {
    const record = registerSubagentRun({
      runId: "run-keep",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Keep session",
      cleanup: "keep",
    });

    expect(record.cleanup).toBe("keep");
  });

  it("registers a run and ends it with error when Hub is not available", () => {
    // Without Hub initialized, watchChildAgent detects missing Hub
    // and immediately ends the run with an error
    registerSubagentRun({
      runId: "run-no-hub",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Running task",
    });

    const record = getSubagentRun("run-no-hub");
    expect(record?.startedAt).toBeGreaterThan(0);
    expect(record?.endedAt).toBeGreaterThan(0);
    expect(record?.outcome?.status).toBe("error");
    expect(record?.outcome?.error).toContain("Hub not initialized");
  });

  it("shutdownSubagentRegistry marks unfinished runs as ended", () => {
    // Directly set up a record without going through watchChildAgent
    // to simulate a run that is still active
    registerSubagentRun({
      runId: "run-active",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Running task",
    });

    // The above run already ended due to no Hub; reset its endedAt
    // to simulate a truly active run
    const record = getSubagentRun("run-active");
    if (record) {
      record.endedAt = undefined;
      record.outcome = undefined;
    }

    shutdownSubagentRegistry();

    const after = getSubagentRun("run-active");
    expect(after?.endedAt).toBeGreaterThan(0);
    expect(after?.outcome?.status).toBe("unknown");
  });

  it("resetSubagentRegistryForTests clears all state", () => {
    registerSubagentRun({
      runId: "run-1",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Task",
    });

    expect(listSubagentRuns("parent-1")).toHaveLength(1);

    resetSubagentRegistryForTests();

    expect(listSubagentRuns("parent-1")).toHaveLength(0);
    expect(getSubagentRun("run-1")).toBeUndefined();
  });
});

describe("subagent registry — coalescing", () => {
  // Without Hub, watchChildAgent ends runs immediately with "Hub not initialized".
  // This allows us to test the coalescing state transitions.

  it("captures findings when a run completes (no Hub)", () => {
    registerSubagentRun({
      runId: "run-1",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Task 1",
    });

    const record = getSubagentRun("run-1");
    // Run ended immediately due to no Hub
    expect(record?.endedAt).toBeGreaterThan(0);
    expect(record?.findingsCaptured).toBe(true);
  });

  it("does not announce while sibling runs are still pending", () => {
    // Register first run — ends immediately (no Hub)
    registerSubagentRun({
      runId: "run-1",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Task 1",
    });

    const record1 = getSubagentRun("run-1");
    expect(record1?.findingsCaptured).toBe(true);

    // Register second run — also ends immediately
    registerSubagentRun({
      runId: "run-2",
      childSessionId: "child-2",
      requesterSessionId: "parent-1",
      task: "Task 2",
    });

    const record2 = getSubagentRun("run-2");
    expect(record2?.findingsCaptured).toBe(true);

    // Both ended, but announce fails because no Hub for parent agent.
    // The key check: both records should have findings captured.
    // announced will be false because runCoalescedAnnounceFlow fails (no Hub).
    expect(record1?.announced).toBeUndefined();
    expect(record2?.announced).toBeUndefined();
  });

  it("single run captures findings immediately", () => {
    registerSubagentRun({
      runId: "run-solo",
      childSessionId: "child-solo",
      requesterSessionId: "parent-solo",
      task: "Solo task",
    });

    const record = getSubagentRun("run-solo");
    expect(record?.endedAt).toBeGreaterThan(0);
    expect(record?.findingsCaptured).toBe(true);
    expect(record?.outcome?.status).toBe("error");
    expect(record?.outcome?.error).toContain("Hub not initialized");
  });

  it("shutdownSubagentRegistry captures findings for ended-but-uncaptured runs", () => {
    registerSubagentRun({
      runId: "run-1",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Task",
    });

    const record = getSubagentRun("run-1");
    if (record) {
      // Simulate: run ended but findings not yet captured
      record.endedAt = Date.now();
      record.outcome = { status: "ok" };
      record.findingsCaptured = undefined;
    }

    shutdownSubagentRegistry();

    expect(record?.findingsCaptured).toBe(true);
  });
});

describe("subagent registry — post-announce cleanup", () => {
  it("removes runs from registry after successful announcement", async () => {
    // Mock runCoalescedAnnounceFlow to succeed
    const announceModule = await import("./announce.js");
    const spy = vi.spyOn(announceModule, "runCoalescedAnnounceFlow").mockReturnValue(true);

    // Register two runs for the same parent — both end immediately (no Hub)
    registerSubagentRun({
      runId: "run-a",
      childSessionId: "child-a",
      requesterSessionId: "parent-1",
      task: "Task A",
    });
    registerSubagentRun({
      runId: "run-b",
      childSessionId: "child-b",
      requesterSessionId: "parent-1",
      task: "Task B",
    });

    // Both runs should have been announced and removed from registry
    expect(spy).toHaveBeenCalled();
    expect(getSubagentRun("run-a")).toBeUndefined();
    expect(getSubagentRun("run-b")).toBeUndefined();
    expect(listSubagentRuns("parent-1")).toHaveLength(0);

    spy.mockRestore();
  });
});
