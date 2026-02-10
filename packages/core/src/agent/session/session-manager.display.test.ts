import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "./session-manager.js";
import { readEntries, writeEntries } from "./storage.js";
import type { SessionEntry } from "./types.js";

describe("SessionManager display content view", () => {
  const testBaseDir = join(tmpdir(), `multica-session-display-${Date.now()}`);

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

  it("uses displayContent for user messages in display view", async () => {
    const sessionId = "display-view";
    const session = new SessionManager({ sessionId, baseDir: testBaseDir });
    const entries: SessionEntry[] = [
      {
        type: "message",
        message: { role: "user", content: "[Mon 2026-02-09 14:37 GMT+8] hi" } as any,
        displayContent: "hi",
        timestamp: 1,
      },
      {
        type: "message",
        message: { role: "assistant", content: "hello there" } as any,
        timestamp: 2,
      },
    ];
    await writeEntries(sessionId, entries, { baseDir: testBaseDir });

    const raw = session.loadMessages();
    const display = session.loadMessagesForDisplay();

    expect((raw[0] as any)?.content).toBe("[Mon 2026-02-09 14:37 GMT+8] hi");
    expect((display[0] as any)?.content).toBe("hi");
    expect((display[1] as any)?.content).toBe("hello there");
  });

  it("keeps internal filtering behavior in display view", async () => {
    const sessionId = "display-internal";
    const session = new SessionManager({ sessionId, baseDir: testBaseDir });
    const entries: SessionEntry[] = [
      {
        type: "message",
        message: { role: "user", content: "[Mon 2026-02-09 14:37 GMT+8] hidden" } as any,
        displayContent: "hidden",
        internal: true,
        timestamp: 1,
      },
      {
        type: "message",
        message: { role: "user", content: "[Mon 2026-02-09 14:38 GMT+8] visible" } as any,
        displayContent: "visible",
        timestamp: 2,
      },
    ];
    await writeEntries(sessionId, entries, { baseDir: testBaseDir });

    const defaultView = session.loadMessagesForDisplay();
    const includeInternalView = session.loadMessagesForDisplay({ includeInternal: true });

    expect(defaultView).toHaveLength(1);
    expect((defaultView[0] as any)?.content).toBe("visible");
    expect(includeInternalView).toHaveLength(2);
    expect((includeInternalView[0] as any)?.content).toBe("hidden");
  });

  it("persists displayContent on saveMessage", async () => {
    const sessionId = "display-save";
    const session = new SessionManager({ sessionId, baseDir: testBaseDir });

    session.saveMessage(
      { role: "user", content: "[Mon 2026-02-09 14:39 GMT+8] save me" } as any,
      { displayContent: "save me" },
    );
    await session.flush();

    const entries = readEntries(sessionId, { baseDir: testBaseDir }) as Array<
      Extract<SessionEntry, { type: "message" }>
    >;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.displayContent).toBe("save me");
  });
});
