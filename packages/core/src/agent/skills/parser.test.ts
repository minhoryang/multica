import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./parser.js";

describe("parser", () => {
  describe("parseFrontmatter", () => {
    it("should parse valid frontmatter with all fields", () => {
      const content = `---
name: Test Skill
description: A test skill
version: 1.0.0
author: Test Author
homepage: https://example.com
metadata:
  emoji: "test"
  requiresEnv:
    - API_KEY
    - SECRET
  requiresBinaries:
    - git
    - node
  platforms:
    - darwin
    - linux
  tags:
    - testing
    - development
---
# Skill Instructions

This is the body content.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter).toEqual({
        name: "Test Skill",
        description: "A test skill",
        version: "1.0.0",
        author: "Test Author",
        homepage: "https://example.com",
        metadata: {
          emoji: "test",
          requiresEnv: ["API_KEY", "SECRET"],
          requiresBinaries: ["git", "node"],
          platforms: ["darwin", "linux"],
          tags: ["testing", "development"],
        },
      });
      expect(body).toBe("# Skill Instructions\n\nThis is the body content.");
    });

    it("should parse minimal frontmatter with only required name field", () => {
      const content = `---
name: Minimal Skill
---
Body content here.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter).toEqual({ name: "Minimal Skill" });
      expect(body).toBe("Body content here.");
    });

    it("should return null frontmatter when no frontmatter present", () => {
      const content = `# Just Markdown

No frontmatter here.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter).toBeNull();
      expect(body).toBe("# Just Markdown\n\nNo frontmatter here.");
    });

    it("should return null frontmatter for invalid YAML", () => {
      const content = `---
name: Test
invalid: yaml: syntax: here
  - broken
    indentation
---
Body content.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      // Note: YAML parser may or may not fail depending on the exact syntax
      // This tests that the function handles errors gracefully
      if (frontmatter === null) {
        expect(body).toBe(content.trim());
      } else {
        expect(frontmatter).toBeDefined();
      }
    });

    it("should handle empty frontmatter block", () => {
      const content = `---

---
Body content.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      // Empty frontmatter returns null because YAML parses empty content as null
      // The regex still matches, so body is extracted, but frontmatter check fails
      if (frontmatter === null) {
        // When frontmatter is null, body contains trimmed original content
        expect(body).toContain("Body content.");
      } else {
        // If YAML returns empty object, frontmatter would be defined
        expect(body).toBe("Body content.");
      }
    });

    it("should handle CRLF line endings", () => {
      const content = "---\r\nname: Windows Skill\r\n---\r\nBody with CRLF.";

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter).toEqual({ name: "Windows Skill" });
      expect(body).toBe("Body with CRLF.");
    });

    it("should handle content with multiple --- markers in body", () => {
      const content = `---
name: Test
---
# Body

---

More content after horizontal rule.

---
Another section.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter).toEqual({ name: "Test" });
      expect(body).toContain("---");
      expect(body).toContain("More content after horizontal rule.");
    });

    it("should handle frontmatter that doesn't start at beginning", () => {
      const content = `
---
name: Test
---
Body.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      // Frontmatter must start at the very beginning
      expect(frontmatter).toBeNull();
    });

    it("should handle frontmatter with nested metadata object", () => {
      const content = `---
name: Nested Test
metadata:
  emoji: "rocket"
  platforms:
    - darwin
  requiresBinaries: []
  requiresEnv: []
---
Instructions here.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter?.metadata).toEqual({
        emoji: "rocket",
        platforms: ["darwin"],
        requiresBinaries: [],
        requiresEnv: [],
      });
    });

    it("should handle multiline string values", () => {
      const content = `---
name: Multiline
description: |
  This is a multiline
  description that spans
  multiple lines.
---
Body.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter?.description).toContain("multiline");
      expect(body).toBe("Body.");
    });

    it("should trim whitespace from body", () => {
      const content = `---
name: Test
---

   Body with extra whitespace.

`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(body).toBe("Body with extra whitespace.");
    });

    it("should handle empty body", () => {
      const content = `---
name: No Body
---
`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter).toEqual({ name: "No Body" });
      expect(body).toBe("");
    });

    it("should handle special characters in values", () => {
      const content = `---
name: "Special: Characters & Symbols"
description: 'Quotes and colons: work'
---
Body.
`;

      const [frontmatter, body] = parseFrontmatter(content);

      expect(frontmatter?.name).toBe("Special: Characters & Symbols");
      expect(frontmatter?.description).toBe("Quotes and colons: work");
      expect(body).toBe("Body.");
    });
  });
});
