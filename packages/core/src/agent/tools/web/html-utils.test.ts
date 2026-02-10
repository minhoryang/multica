import { describe, it, expect } from "vitest";
import {
  htmlToMarkdownSimple,
  markdownToText,
  truncateText,
  convertWithTurndown,
} from "./html-utils.js";

describe("html-utils", () => {
  describe("htmlToMarkdownSimple", () => {
    it("should extract title from HTML", () => {
      const html = "<html><head><title>Test Page</title></head><body>Content</body></html>";
      const result = htmlToMarkdownSimple(html);
      expect(result.title).toBe("Test Page");
    });

    it("should handle missing title", () => {
      const html = "<html><body>Content</body></html>";
      const result = htmlToMarkdownSimple(html);
      expect(result.title).toBeUndefined();
    });

    it("should remove script tags", () => {
      const html = "<p>Before</p><script>alert('xss');</script><p>After</p>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).not.toContain("alert");
      expect(result.text).toContain("Before");
      expect(result.text).toContain("After");
    });

    it("should remove style tags", () => {
      const html = "<p>Content</p><style>.red { color: red; }</style>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).not.toContain("color");
      expect(result.text).toContain("Content");
    });

    it("should remove noscript tags", () => {
      const html = "<p>Content</p><noscript>Enable JavaScript</noscript>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).not.toContain("JavaScript");
    });

    it("should convert links to markdown format", () => {
      const html = '<a href="https://example.com">Example</a>';
      const result = htmlToMarkdownSimple(html);
      expect(result.text).toBe("[Example](https://example.com)");
    });

    it("should handle links without text", () => {
      const html = '<a href="https://example.com"></a>';
      const result = htmlToMarkdownSimple(html);
      expect(result.text).toBe("https://example.com");
    });

    it("should convert headings to markdown", () => {
      const html = "<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).toContain("# Title");
      expect(result.text).toContain("## Subtitle");
      expect(result.text).toContain("### Section");
    });

    it("should convert list items", () => {
      const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).toContain("- Item 1");
      expect(result.text).toContain("- Item 2");
    });

    it("should convert br and hr tags", () => {
      const html = "<p>Line 1<br/>Line 2</p><hr/><p>Line 3</p>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).toContain("Line 1");
      expect(result.text).toContain("Line 2");
      expect(result.text).toContain("Line 3");
    });

    it("should decode HTML entities", () => {
      const html = "<p>Hello &amp; World &lt;test&gt;</p>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).toContain("Hello & World <test>");
    });

    it("should decode numeric entities", () => {
      const html = "<p>&#60;tag&#62; &#x3C;hex&#x3E;</p>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).toContain("<tag>");
      expect(result.text).toContain("<hex>");
    });

    it("should normalize whitespace", () => {
      const html = "<p>Text   with    lots   of   spaces</p>";
      const result = htmlToMarkdownSimple(html);
      expect(result.text).not.toContain("   ");
    });

    it("should handle empty HTML", () => {
      const result = htmlToMarkdownSimple("");
      expect(result.text).toBe("");
      expect(result.title).toBeUndefined();
    });
  });

  describe("markdownToText", () => {
    it("should remove image syntax", () => {
      const md = "Text ![alt](image.png) more text";
      const result = markdownToText(md);
      expect(result).not.toContain("![");
      expect(result).toContain("Text");
      expect(result).toContain("more text");
    });

    it("should extract link text and remove URLs", () => {
      const md = "Click [here](https://example.com) for more";
      const result = markdownToText(md);
      expect(result).toBe("Click here for more");
    });

    it("should remove code blocks", () => {
      const md = "Text\n```javascript\nconst x = 1;\n```\nMore text";
      const result = markdownToText(md);
      expect(result).not.toContain("```");
      expect(result).toContain("const x = 1;");
    });

    it("should remove inline code backticks", () => {
      const md = "Use the `console.log` function";
      const result = markdownToText(md);
      expect(result).toBe("Use the console.log function");
    });

    it("should remove heading markers", () => {
      const md = "# Title\n## Subtitle\n### Section";
      const result = markdownToText(md);
      expect(result).not.toContain("#");
      expect(result).toContain("Title");
      expect(result).toContain("Subtitle");
    });

    it("should remove list markers", () => {
      const md = "- Item 1\n* Item 2\n+ Item 3\n1. Numbered";
      const result = markdownToText(md);
      expect(result).not.toMatch(/^[-*+]\s/m);
      expect(result).not.toMatch(/^\d+\.\s/m);
      expect(result).toContain("Item 1");
    });

    it("should handle empty string", () => {
      expect(markdownToText("")).toBe("");
    });

    it("should normalize whitespace", () => {
      const md = "Text  with   spaces\n\n\nand lines";
      const result = markdownToText(md);
      expect(result).not.toContain("   ");
      expect(result).not.toContain("\n\n\n");
    });
  });

  describe("truncateText", () => {
    it("should not truncate text under max length", () => {
      const result = truncateText("Hello", 10);
      expect(result.text).toBe("Hello");
      expect(result.truncated).toBe(false);
    });

    it("should truncate text over max length", () => {
      const result = truncateText("Hello World", 5);
      expect(result.text).toBe("Hello");
      expect(result.truncated).toBe(true);
    });

    it("should handle exact length", () => {
      const result = truncateText("Hello", 5);
      expect(result.text).toBe("Hello");
      expect(result.truncated).toBe(false);
    });

    it("should handle empty string", () => {
      const result = truncateText("", 10);
      expect(result.text).toBe("");
      expect(result.truncated).toBe(false);
    });

    it("should handle zero max chars", () => {
      const result = truncateText("Hello", 0);
      expect(result.text).toBe("");
      expect(result.truncated).toBe(true);
    });
  });

  describe("convertWithTurndown", () => {
    it("should convert HTML to markdown", () => {
      const html = "<html><head><title>Page</title></head><body><h1>Hello</h1><p>World</p></body></html>";
      const result = convertWithTurndown(html);
      expect(result.title).toBe("Page");
      expect(result.text).toContain("# Hello");
      expect(result.text).toContain("World");
    });

    it("should remove script and style tags", () => {
      const html = "<script>alert(1)</script><style>.x{}</style><p>Content</p>";
      const result = convertWithTurndown(html);
      expect(result.text).not.toContain("alert");
      expect(result.text).not.toContain(".x{}");
      expect(result.text).toContain("Content");
    });

    it("should convert links", () => {
      const html = '<a href="https://example.com">Link</a>';
      const result = convertWithTurndown(html);
      expect(result.text).toContain("[Link](https://example.com)");
    });

    it("should convert lists with dash markers", () => {
      const html = "<ul><li>One</li><li>Two</li></ul>";
      const result = convertWithTurndown(html);
      expect(result.text).toContain("-");
      expect(result.text).toContain("One");
      expect(result.text).toContain("Two");
    });

    it("should handle code blocks", () => {
      const html = "<pre><code>const x = 1;</code></pre>";
      const result = convertWithTurndown(html);
      expect(result.text).toContain("const x = 1;");
    });
  });
});
