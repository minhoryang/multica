import { describe, it, expect } from "vitest";
import {
  toolDisplayName,
  formatToolArgs,
  extractResultDetails,
  formatResultSummary,
} from "./output.js";

describe("output", () => {
  describe("toolDisplayName", () => {
    it("should map known tool names to display names", () => {
      expect(toolDisplayName("read")).toBe("ReadFile");
      expect(toolDisplayName("write")).toBe("WriteFile");
      expect(toolDisplayName("edit")).toBe("EditFile");
      expect(toolDisplayName("glob")).toBe("Glob");
      expect(toolDisplayName("web_search")).toBe("WebSearch");
      expect(toolDisplayName("web_fetch")).toBe("WebFetch");
    });

    it("should return original name for unknown tools", () => {
      expect(toolDisplayName("custom_tool")).toBe("custom_tool");
      expect(toolDisplayName("unknown")).toBe("unknown");
    });
  });

  describe("formatToolArgs", () => {
    it("should return empty string for null/undefined args", () => {
      expect(formatToolArgs("read", null)).toBe("");
      expect(formatToolArgs("read", undefined)).toBe("");
    });

    it("should return empty string for non-object args", () => {
      expect(formatToolArgs("read", "string")).toBe("");
      expect(formatToolArgs("read", 123)).toBe("");
    });

    it("should format read tool args", () => {
      expect(formatToolArgs("read", { path: "/foo/bar.ts" })).toBe("/foo/bar.ts");
      expect(formatToolArgs("read", { file: "/foo/bar.ts" })).toBe("/foo/bar.ts");
    });

    it("should format glob tool args", () => {
      expect(formatToolArgs("glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
      expect(formatToolArgs("glob", { pattern: "**/*.ts", cwd: "/src" })).toBe("**/*.ts in /src");
    });

    it("should format web_search tool args with truncation", () => {
      expect(formatToolArgs("web_search", { query: "short query" })).toBe("short query");
      const longQuery = "a".repeat(60);
      expect(formatToolArgs("web_search", { query: longQuery })).toBe("a".repeat(50) + "…");
    });

    it("should format web_fetch tool args with URL parsing", () => {
      expect(formatToolArgs("web_fetch", { url: "https://example.com" })).toBe("example.com");
      expect(formatToolArgs("web_fetch", { url: "https://example.com/" })).toBe("example.com");
      expect(formatToolArgs("web_fetch", { url: "https://example.com/path/to/page" })).toBe(
        "example.com/path/to/page"
      );
    });

    it("should truncate long URL paths", () => {
      const longPath = "/very/long/path/that/exceeds/thirty/characters/limit";
      expect(formatToolArgs("web_fetch", { url: `https://example.com${longPath}` })).toBe(
        "example.com" + longPath.slice(0, 30) + "…"
      );
    });

    it("should handle invalid URLs gracefully", () => {
      expect(formatToolArgs("web_fetch", { url: "not-a-valid-url" })).toBe("not-a-valid-url");
      const longInvalid = "x".repeat(60);
      expect(formatToolArgs("web_fetch", { url: longInvalid })).toBe("x".repeat(50) + "…");
    });

    it("should return empty string for unknown tools", () => {
      expect(formatToolArgs("unknown_tool", { foo: "bar" })).toBe("");
    });
  });

  describe("extractResultDetails", () => {
    it("should return null for null/undefined", () => {
      expect(extractResultDetails(null)).toBeNull();
      expect(extractResultDetails(undefined)).toBeNull();
    });

    it("should return null for non-objects", () => {
      expect(extractResultDetails("string")).toBeNull();
      expect(extractResultDetails(123)).toBeNull();
    });

    it("should extract JSON from AgentMessage content array", () => {
      const result = {
        content: [{ type: "text", text: '{"count": 5, "files": ["a.ts", "b.ts"]}' }],
      };
      expect(extractResultDetails(result)).toEqual({ count: 5, files: ["a.ts", "b.ts"] });
    });

    it("should skip non-text content items", () => {
      const result = {
        content: [
          { type: "image", data: "..." },
          { type: "text", text: '{"value": 42}' },
        ],
      };
      expect(extractResultDetails(result)).toEqual({ value: 42 });
    });

    it("should handle invalid JSON gracefully", () => {
      const result = {
        content: [{ type: "text", text: "not json" }],
      };
      // Falls back to returning the object itself
      expect(extractResultDetails(result)).toEqual(result);
    });

    it("should prefer details when present", () => {
      const result = {
        content: [{ type: "text", text: "not json" }],
        details: { count: 3, truncated: false },
      };
      expect(extractResultDetails(result)).toEqual({ count: 3, truncated: false });
    });

    it("should return direct object if no content array", () => {
      const result = { count: 10, truncated: true };
      expect(extractResultDetails(result)).toEqual({ count: 10, truncated: true });
    });
  });

  describe("formatResultSummary", () => {
    describe("glob", () => {
      it("should format file count from count field", () => {
        const result = { content: [{ type: "text", text: '{"count": 5}' }] };
        expect(formatResultSummary("glob", result)).toBe("5 files");
      });

      it("should format file count from files array length", () => {
        const result = {
          content: [{ type: "text", text: '{"files": ["a.ts", "b.ts", "c.ts"]}' }],
        };
        expect(formatResultSummary("glob", result)).toBe("3 files");
      });

      it("should show + for truncated results", () => {
        const result = { content: [{ type: "text", text: '{"count": 100, "truncated": true}' }] };
        expect(formatResultSummary("glob", result)).toBe("100+ files");
      });

      it("should handle zero files", () => {
        const result = { content: [{ type: "text", text: '{"count": 0, "files": []}' }] };
        expect(formatResultSummary("glob", result)).toBe("0 files");
      });
    });

    describe("web_search", () => {
      it("should format error results", () => {
        const result = { content: [{ type: "text", text: '{"error": true, "message": "API error"}' }] };
        expect(formatResultSummary("web_search", result)).toBe("error: API error");
      });

      it("should format Perplexity results with citations", () => {
        const result = {
          content: [
            {
              type: "text",
              text: '{"content": "answer text", "citations": ["url1", "url2", "url3"]}',
            },
          ],
        };
        expect(formatResultSummary("web_search", result)).toBe("3 citations");
      });

      it("should format Brave results with count", () => {
        const result = { content: [{ type: "text", text: '{"count": 10}' }] };
        expect(formatResultSummary("web_search", result)).toBe("10 results");
      });

      it("should count results array if no count field", () => {
        const result = {
          content: [{ type: "text", text: '{"results": [{}, {}, {}]}' }],
        };
        expect(formatResultSummary("web_search", result)).toBe("3 results");
      });
    });

    describe("web_fetch", () => {
      it("should format error results", () => {
        const result = {
          content: [{ type: "text", text: '{"error": true, "message": "404 Not Found"}' }],
        };
        expect(formatResultSummary("web_fetch", result)).toBe("error: 404 Not Found");
      });

      it("should format title", () => {
        const result = { content: [{ type: "text", text: '{"title": "Example Page"}' }] };
        expect(formatResultSummary("web_fetch", result)).toBe('"Example Page"');
      });

      it("should truncate long titles", () => {
        const longTitle = "A".repeat(50);
        const result = { content: [{ type: "text", text: `{"title": "${longTitle}"}` }] };
        expect(formatResultSummary("web_fetch", result)).toBe(`"${"A".repeat(30)}…"`);
      });

      it("should format content length in KB", () => {
        const result = { content: [{ type: "text", text: '{"length": 2048}' }] };
        expect(formatResultSummary("web_fetch", result)).toBe("2.0KB");
      });

      it("should show cached indicator", () => {
        const result = { content: [{ type: "text", text: '{"cached": true}' }] };
        expect(formatResultSummary("web_fetch", result)).toBe("cached");
      });

      it("should combine multiple fields", () => {
        const result = {
          content: [{ type: "text", text: '{"title": "Page", "length": 1024, "cached": true}' }],
        };
        expect(formatResultSummary("web_fetch", result)).toBe('"Page", 1.0KB, cached');
      });
    });

    describe("grep", () => {
      it("should return 'no matches' for empty results", () => {
        const result = { content: [{ type: "text", text: "No matches found" }] };
        expect(formatResultSummary("grep", result)).toBe("no matches");
      });

      it("should count non-empty lines as matches", () => {
        const result = {
          content: [{ type: "text", text: "file.ts:1:match1\nfile.ts:2:match2\nfile.ts:3:match3" }],
        };
        expect(formatResultSummary("grep", result)).toBe("3 matches");
      });

      it("should ignore empty lines when counting", () => {
        const result = {
          content: [{ type: "text", text: "file.ts:1:match1\n\nfile.ts:2:match2\n" }],
        };
        expect(formatResultSummary("grep", result)).toBe("2 matches");
      });
    });

    it("should return empty string for unknown tools", () => {
      const result = { content: [{ type: "text", text: '{"data": "value"}' }] };
      expect(formatResultSummary("unknown_tool", result)).toBe("");
    });

    it("should return empty string for null result", () => {
      expect(formatResultSummary("glob", null)).toBe("");
    });
  });
});
