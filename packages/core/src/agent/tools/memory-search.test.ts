import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createMemorySearchTool } from "./memory-search.js";

describe("memory_search tool", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `memory-search-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("creates tool with correct name and description", () => {
    const tool = createMemorySearchTool(testDir);
    expect(tool.name).toBe("memory_search");
    expect(tool.label).toBe("Memory Search");
    expect(tool.description).toContain("memory files");
  });

  it("returns no matches when no memory files exist", async () => {
    const tool = createMemorySearchTool(testDir);
    const result = await tool.execute("test-call", { query: "test" }, undefined);
    expect(result.details?.matches).toHaveLength(0);
    expect(result.details?.filesSearched).toBe(0);
  });

  it("searches memory.md file", async () => {
    // Create memory.md with test content
    writeFileSync(
      join(testDir, "memory.md"),
      "# Memory\n\nUser prefers TypeScript over JavaScript.\n\nDecision: Use ESLint for linting.\n",
    );

    const tool = createMemorySearchTool(testDir);
    const result = await tool.execute("test-call", { query: "TypeScript" }, undefined);

    expect(result.details?.matches).toHaveLength(1);
    expect(result.details?.matches[0]?.file).toBe("memory.md");
    expect(result.details?.matches[0]?.content).toContain("TypeScript");
  });

  it("searches memory/*.md files", async () => {
    // Create memory directory with daily logs
    const memoryDir = join(testDir, "memory");
    mkdirSync(memoryDir);
    writeFileSync(
      join(memoryDir, "2024-01-15.md"),
      "# 2024-01-15\n\nDiscussed API design with team.\n",
    );
    writeFileSync(
      join(memoryDir, "2024-01-16.md"),
      "# 2024-01-16\n\nImplemented user authentication.\n",
    );

    const tool = createMemorySearchTool(testDir);
    const result = await tool.execute("test-call", { query: "API" }, undefined);

    expect(result.details?.matches).toHaveLength(1);
    expect(result.details?.matches[0]?.file).toBe("memory/2024-01-15.md");
  });

  it("searches both memory.md and memory/*.md", async () => {
    // Create memory.md
    writeFileSync(join(testDir, "memory.md"), "Important: Always test code.\n");

    // Create memory directory
    const memoryDir = join(testDir, "memory");
    mkdirSync(memoryDir);
    writeFileSync(join(memoryDir, "2024-01-15.md"), "Remember to test before deploy.\n");

    const tool = createMemorySearchTool(testDir);
    const result = await tool.execute("test-call", { query: "test" }, undefined);

    expect(result.details?.matches).toHaveLength(2);
    expect(result.details?.filesSearched).toBe(2);
  });

  it("is case-insensitive by default", async () => {
    writeFileSync(join(testDir, "memory.md"), "User prefers TYPESCRIPT.\n");

    const tool = createMemorySearchTool(testDir);
    const result = await tool.execute("test-call", { query: "typescript" }, undefined);

    expect(result.details?.matches).toHaveLength(1);
  });

  it("supports case-sensitive search", async () => {
    writeFileSync(join(testDir, "memory.md"), "User prefers TYPESCRIPT.\n");

    const tool = createMemorySearchTool(testDir);

    // Case-sensitive search should not match
    const result1 = await tool.execute(
      "test-call",
      { query: "typescript", caseSensitive: true },
      undefined,
    );
    expect(result1.details?.matches).toHaveLength(0);

    // Case-sensitive search should match
    const result2 = await tool.execute(
      "test-call",
      { query: "TYPESCRIPT", caseSensitive: true },
      undefined,
    );
    expect(result2.details?.matches).toHaveLength(1);
  });

  it("includes context lines in results", async () => {
    writeFileSync(
      join(testDir, "memory.md"),
      "Line 1\nLine 2\nMatch here\nLine 4\nLine 5\n",
    );

    const tool = createMemorySearchTool(testDir);
    const result = await tool.execute("test-call", { query: "Match" }, undefined);

    expect(result.details?.matches).toHaveLength(1);
    expect(result.details?.matches[0]?.context.before).toContain("Line 2");
    expect(result.details?.matches[0]?.context.after).toContain("Line 4");
  });

  it("respects maxResults limit", async () => {
    // Create file with multiple matches
    writeFileSync(
      join(testDir, "memory.md"),
      "test line 1\ntest line 2\ntest line 3\ntest line 4\ntest line 5\n",
    );

    const tool = createMemorySearchTool(testDir);
    const result = await tool.execute(
      "test-call",
      { query: "test", maxResults: 2 },
      undefined,
    );

    expect(result.details?.matches).toHaveLength(2);
    expect(result.details?.totalMatches).toBe(5);
    expect(result.details?.truncated).toBe(true);
  });

  it("throws error for empty query", async () => {
    const tool = createMemorySearchTool(testDir);
    await expect(tool.execute("test-call", { query: "" }, undefined)).rejects.toThrow(
      "Query must not be empty",
    );
  });
});
