import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGlobTool, type GlobResult } from "./glob.js";

describe("glob", () => {
  const testDir = join(tmpdir(), `multica-glob-test-${Date.now()}`);

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Create test file structure
    mkdirSync(join(testDir, "src"), { recursive: true });
    mkdirSync(join(testDir, "src/components"), { recursive: true });
    mkdirSync(join(testDir, "test"), { recursive: true });

    writeFileSync(join(testDir, "package.json"), "{}");
    writeFileSync(join(testDir, "src/index.ts"), "export {}");
    writeFileSync(join(testDir, "src/utils.ts"), "export {}");
    writeFileSync(join(testDir, "src/components/Button.tsx"), "export {}");
    writeFileSync(join(testDir, "src/components/Input.tsx"), "export {}");
    writeFileSync(join(testDir, "test/index.test.ts"), "test()");
    writeFileSync(join(testDir, ".config"), "hidden");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("createGlobTool", () => {
    it("should create a glob tool with correct properties", () => {
      const tool = createGlobTool(testDir);

      expect(tool.name).toBe("glob");
      expect(tool.label).toBe("Glob");
      expect(tool.description).toContain("Find files matching a glob pattern");
      expect(tool.execute).toBeInstanceOf(Function);
    });

    it("should find files matching simple pattern", async () => {
      const tool = createGlobTool(testDir);
      const result = await tool.execute("test-id", { pattern: "*.json" }, new AbortController().signal);

      expect(result.details.files).toContain("package.json");
      expect(result.details.count).toBe(1);
      expect(result.details.truncated).toBe(false);
    });

    it("should find TypeScript files recursively", async () => {
      const tool = createGlobTool(testDir);
      const result = await tool.execute("test-id", { pattern: "**/*.ts" }, new AbortController().signal);

      expect(result.details.files).toContain("src/index.ts");
      expect(result.details.files).toContain("src/utils.ts");
      expect(result.details.files).toContain("test/index.test.ts");
      expect(result.details.count).toBe(3);
    });

    it("should find TSX files in specific directory", async () => {
      const tool = createGlobTool(testDir);
      const result = await tool.execute(
        "test-id",
        { pattern: "src/components/*.tsx" },
        new AbortController().signal
      );

      expect(result.details.files).toContain("src/components/Button.tsx");
      expect(result.details.files).toContain("src/components/Input.tsx");
      expect(result.details.count).toBe(2);
    });

    it("should include dotfiles", async () => {
      const tool = createGlobTool(testDir);
      const result = await tool.execute("test-id", { pattern: ".*" }, new AbortController().signal);

      expect(result.details.files).toContain(".config");
    });

    it("should respect limit parameter", async () => {
      const tool = createGlobTool(testDir);
      const result = await tool.execute(
        "test-id",
        { pattern: "**/*", limit: 2 },
        new AbortController().signal
      );

      expect(result.details.count).toBe(2);
      expect(result.details.truncated).toBe(true);
    });

    it("should respect ignore patterns", async () => {
      const tool = createGlobTool(testDir);
      const result = await tool.execute(
        "test-id",
        { pattern: "**/*.ts", ignore: ["test/**"] },
        new AbortController().signal
      );

      expect(result.details.files).toContain("src/index.ts");
      expect(result.details.files).not.toContain("test/index.test.ts");
    });

    it("should use custom cwd", async () => {
      const tool = createGlobTool("/other/path");
      const result = await tool.execute(
        "test-id",
        { pattern: "*.ts", cwd: join(testDir, "src") },
        new AbortController().signal
      );

      expect(result.details.files).toContain("index.ts");
      expect(result.details.files).toContain("utils.ts");
    });

    it("should throw error for empty pattern", async () => {
      const tool = createGlobTool(testDir);

      await expect(
        tool.execute("test-id", { pattern: "" }, new AbortController().signal)
      ).rejects.toThrow("Pattern must not be empty");
    });

    it("should throw error for whitespace-only pattern", async () => {
      const tool = createGlobTool(testDir);

      await expect(
        tool.execute("test-id", { pattern: "   " }, new AbortController().signal)
      ).rejects.toThrow("Pattern must not be empty");
    });

    it("should throw error for non-existent directory", async () => {
      const tool = createGlobTool(testDir);

      await expect(
        tool.execute("test-id", { pattern: "*.ts", cwd: "/non/existent/path" }, new AbortController().signal)
      ).rejects.toThrow("Directory not found");
    });

    it("should throw error when cwd is a file", async () => {
      const tool = createGlobTool(testDir);
      const filePath = join(testDir, "package.json");

      await expect(
        tool.execute("test-id", { pattern: "*.ts", cwd: filePath }, new AbortController().signal)
      ).rejects.toThrow("Path is not a directory");
    });

    it("should return message when no files match", async () => {
      const tool = createGlobTool(testDir);
      const result = await tool.execute(
        "test-id",
        { pattern: "**/*.xyz" },
        new AbortController().signal
      );

      expect(result.details.count).toBe(0);
      expect(result.details.files).toHaveLength(0);
      const content = result.content[0];
      expect(content).toBeDefined();
      expect(content?.type).toBe("text");
      if (content?.type === "text") {
        expect(content.text).toContain("No files found");
      }
    });

    it("should sort files by modification time (most recent first)", async () => {
      // Create files with different modification times
      const laterFile = join(testDir, "later.ts");
      writeFileSync(laterFile, "// created later");

      // Wait a bit to ensure different mtime
      await new Promise((resolve) => setTimeout(resolve, 100));

      const latestFile = join(testDir, "latest.ts");
      writeFileSync(latestFile, "// created latest");

      const tool = createGlobTool(testDir);
      const result = await tool.execute(
        "test-id",
        { pattern: "*.ts" },
        new AbortController().signal
      );

      // The latest file should be first
      expect(result.details.files[0]).toBe("latest.ts");
    });

    it("should use default limit of 100", async () => {
      // Create more than 100 files
      for (let i = 0; i < 110; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), "content");
      }

      const tool = createGlobTool(testDir);
      const result = await tool.execute(
        "test-id",
        { pattern: "*.txt" },
        new AbortController().signal
      );

      expect(result.details.count).toBe(100);
      expect(result.details.truncated).toBe(true);
    });

    it("should limit to max 1000 files", async () => {
      const tool = createGlobTool(testDir);
      const result = await tool.execute(
        "test-id",
        { pattern: "**/*", limit: 5000 },
        new AbortController().signal
      );

      // The limit should be capped at 1000
      expect(result.details.count).toBeLessThanOrEqual(1000);
    });
  });
});
