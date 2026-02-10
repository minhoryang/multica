import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveBaseDir,
  resolveSessionDir,
  resolveSessionPath,
  ensureSessionDir,
  readEntries,
  appendEntry,
  writeEntries,
} from "./storage.js";
import type { SessionEntry } from "./types.js";

describe("session/storage", () => {
  const testBaseDir = join(tmpdir(), `multica-session-test-${Date.now()}`);

  beforeEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true });
    }
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true });
    }
  });

  describe("resolveBaseDir", () => {
    it("should return custom baseDir when provided", () => {
      const result = resolveBaseDir({ baseDir: "/custom/path" });
      expect(result).toBe("/custom/path");
    });

    it("should return default path when no options provided", () => {
      const result = resolveBaseDir();
      expect(result).toContain(".super-multica");
      expect(result).toContain("sessions");
    });

    it("should return default path when options is empty", () => {
      const result = resolveBaseDir({});
      expect(result).toContain("sessions");
    });
  });

  describe("resolveSessionDir", () => {
    it("should return session directory path", () => {
      const result = resolveSessionDir("test-session", { baseDir: testBaseDir });
      expect(result).toBe(join(testBaseDir, "test-session"));
    });

    it("should handle session IDs with special characters", () => {
      const result = resolveSessionDir("session-123-abc", { baseDir: testBaseDir });
      expect(result).toBe(join(testBaseDir, "session-123-abc"));
    });
  });

  describe("resolveSessionPath", () => {
    it("should return path to session.jsonl file", () => {
      const result = resolveSessionPath("test-session", { baseDir: testBaseDir });
      expect(result).toBe(join(testBaseDir, "test-session", "session.jsonl"));
    });
  });

  describe("ensureSessionDir", () => {
    it("should create session directory if it does not exist", () => {
      const sessionId = "new-session";
      ensureSessionDir(sessionId, { baseDir: testBaseDir });

      const dir = join(testBaseDir, sessionId);
      expect(existsSync(dir)).toBe(true);
    });

    it("should not fail if directory already exists", () => {
      const sessionId = "existing-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      expect(() => ensureSessionDir(sessionId, { baseDir: testBaseDir })).not.toThrow();
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("readEntries", () => {
    it("should return empty array for non-existent session", () => {
      const entries = readEntries("non-existent", { baseDir: testBaseDir });
      expect(entries).toEqual([]);
    });

    it("should return empty array for empty file", () => {
      const sessionId = "empty-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "session.jsonl"), "");

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toEqual([]);
    });

    it("should parse valid JSONL entries", () => {
      const sessionId = "valid-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      const entry1: SessionEntry = {
        type: "message",
        message: { role: "user", content: "Hello" } as any,
        timestamp: 1000,
      };
      const entry2: SessionEntry = {
        type: "message",
        message: { role: "assistant", content: "Hi there" } as any,
        timestamp: 2000,
      };

      writeFileSync(
        join(dir, "session.jsonl"),
        `${JSON.stringify(entry1)}\n${JSON.stringify(entry2)}\n`
      );

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual(entry1);
      expect(entries[1]).toEqual(entry2);
    });

    it("should skip malformed lines", () => {
      const sessionId = "malformed-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      const validEntry: SessionEntry = {
        type: "message",
        message: { role: "user", content: "Valid" } as any,
        timestamp: 1000,
      };

      writeFileSync(
        join(dir, "session.jsonl"),
        `${JSON.stringify(validEntry)}\nnot valid json\n{broken: json}\n`
      );

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(validEntry);
    });

    it("should handle meta entries", () => {
      const sessionId = "meta-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      const metaEntry: SessionEntry = {
        type: "meta",
        meta: { provider: "anthropic", model: "claude-3" },
        timestamp: 1000,
      };

      writeFileSync(join(dir, "session.jsonl"), `${JSON.stringify(metaEntry)}\n`);

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(metaEntry);
    });

    it("should handle compaction entries", () => {
      const sessionId = "compaction-session";
      const dir = join(testBaseDir, sessionId);
      mkdirSync(dir, { recursive: true });

      const compactionEntry: SessionEntry = {
        type: "compaction",
        removed: 10,
        kept: 5,
        timestamp: 1000,
        tokensRemoved: 500,
        tokensKept: 200,
        reason: "tokens",
      };

      writeFileSync(join(dir, "session.jsonl"), `${JSON.stringify(compactionEntry)}\n`);

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(compactionEntry);
    });
  });

  describe("appendEntry", () => {
    it("should create file and append entry", async () => {
      const sessionId = "append-session";
      const entry: SessionEntry = {
        type: "message",
        message: { role: "user", content: "Hello" } as any,
        timestamp: 1000,
      };

      await appendEntry(sessionId, entry, { baseDir: testBaseDir });

      const filePath = join(testBaseDir, sessionId, "session.jsonl");
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, "utf8");
      expect(content).toBe(`${JSON.stringify(entry)}\n`);
    });

    it("should append to existing file", async () => {
      const sessionId = "append-existing";
      const entry1: SessionEntry = {
        type: "message",
        message: { role: "user", content: "First" } as any,
        timestamp: 1000,
      };
      const entry2: SessionEntry = {
        type: "message",
        message: { role: "assistant", content: "Second" } as any,
        timestamp: 2000,
      };

      await appendEntry(sessionId, entry1, { baseDir: testBaseDir });
      await appendEntry(sessionId, entry2, { baseDir: testBaseDir });

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual(entry1);
      expect(entries[1]).toEqual(entry2);
    });
  });

  describe("writeEntries", () => {
    it("should write all entries to file", async () => {
      const sessionId = "write-session";
      const entries: SessionEntry[] = [
        { type: "message", message: { role: "user", content: "One" } as any, timestamp: 1000 },
        { type: "message", message: { role: "assistant", content: "Two" } as any, timestamp: 2000 },
      ];

      await writeEntries(sessionId, entries, { baseDir: testBaseDir });

      const readBack = readEntries(sessionId, { baseDir: testBaseDir });
      expect(readBack).toHaveLength(2);
      expect(readBack).toEqual(entries);
    });

    it("should overwrite existing entries", async () => {
      const sessionId = "overwrite-session";

      await writeEntries(
        sessionId,
        [{ type: "message", message: { role: "user", content: "Old" } as any, timestamp: 1000 }],
        { baseDir: testBaseDir }
      );

      const newEntries: SessionEntry[] = [
        { type: "message", message: { role: "user", content: "New" } as any, timestamp: 2000 },
      ];
      await writeEntries(sessionId, newEntries, { baseDir: testBaseDir });

      const entries = readEntries(sessionId, { baseDir: testBaseDir });
      expect(entries).toHaveLength(1);
      expect((entries[0] as any).message.content).toBe("New");
    });

    it("should handle empty entries array", async () => {
      const sessionId = "empty-write";
      await writeEntries(sessionId, [], { baseDir: testBaseDir });

      const filePath = join(testBaseDir, sessionId, "session.jsonl");
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf8")).toBe("");
    });
  });
});
