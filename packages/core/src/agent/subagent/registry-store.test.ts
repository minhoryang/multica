import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SubagentRunRecord } from "./types.js";

// We need to test the store functions with a custom directory.
// Since the store uses DATA_DIR from shared, we test the serialization logic directly.

describe("registry-store serialization", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "subagent-store-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("round-trips SubagentRunRecord through JSON", () => {
    const record: SubagentRunRecord = {
      runId: "run-123",
      childSessionId: "child-456",
      requesterSessionId: "parent-789",
      task: "Analyze code quality",
      label: "Code Review",
      cleanup: "delete",
      createdAt: Date.now(),
      startedAt: Date.now(),
      endedAt: Date.now() + 30000,
      outcome: { status: "ok" },
      archiveAtMs: Date.now() + 3600000,
      cleanupHandled: true,
      cleanupCompletedAt: Date.now() + 30100,
    };

    // Serialize and deserialize
    const json = JSON.stringify({ version: 1, runs: { "run-123": record } });
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(1);
    expect(parsed.runs["run-123"]).toEqual(record);
  });

  it("handles record with minimal fields", () => {
    const record: SubagentRunRecord = {
      runId: "run-minimal",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Do something",
      cleanup: "keep",
      createdAt: Date.now(),
    };

    const json = JSON.stringify({ version: 1, runs: { "run-minimal": record } });
    const parsed = JSON.parse(json);

    expect(parsed.runs["run-minimal"].runId).toBe("run-minimal");
    expect(parsed.runs["run-minimal"].outcome).toBeUndefined();
    expect(parsed.runs["run-minimal"].label).toBeUndefined();
  });

  it("handles error outcome serialization", () => {
    const record: SubagentRunRecord = {
      runId: "run-err",
      childSessionId: "child-err",
      requesterSessionId: "parent-1",
      task: "Fail",
      cleanup: "delete",
      createdAt: Date.now(),
      outcome: { status: "error", error: "Something went wrong" },
    };

    const json = JSON.stringify(record);
    const parsed = JSON.parse(json) as SubagentRunRecord;

    expect(parsed.outcome?.status).toBe("error");
    expect(parsed.outcome?.error).toBe("Something went wrong");
  });

  it("round-trips coalescing fields (findings, findingsCaptured, announced)", () => {
    const record: SubagentRunRecord = {
      runId: "run-coalesce",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Coalesce test",
      cleanup: "delete",
      createdAt: Date.now(),
      endedAt: Date.now() + 5000,
      outcome: { status: "ok" },
      findings: "Found 3 issues in auth module.",
      findingsCaptured: true,
      announced: true,
    };

    const json = JSON.stringify({ version: 1, runs: { "run-coalesce": record } });
    const parsed = JSON.parse(json);
    const restored = parsed.runs["run-coalesce"] as SubagentRunRecord;

    expect(restored.findings).toBe("Found 3 issues in auth module.");
    expect(restored.findingsCaptured).toBe(true);
    expect(restored.announced).toBe(true);
  });

  it("round-trips record with undefined coalescing fields", () => {
    const record: SubagentRunRecord = {
      runId: "run-old",
      childSessionId: "child-1",
      requesterSessionId: "parent-1",
      task: "Old record",
      cleanup: "delete",
      createdAt: Date.now(),
      cleanupHandled: true,
      // No findings, findingsCaptured, or announced fields (old format)
    };

    const json = JSON.stringify({ version: 1, runs: { "run-old": record } });
    const parsed = JSON.parse(json);
    const restored = parsed.runs["run-old"] as SubagentRunRecord;

    expect(restored.findings).toBeUndefined();
    expect(restored.findingsCaptured).toBeUndefined();
    expect(restored.announced).toBeUndefined();
    expect(restored.cleanupHandled).toBe(true);
  });
});
