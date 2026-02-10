import { describe, it, expect } from "vitest";
import { readStringParam, readNumberParam, jsonResult } from "./param-helpers.js";

// Helper to safely get text content from result
function getTextContent(result: ReturnType<typeof jsonResult>): string {
  const content = result.content[0];
  if (content?.type === "text") {
    return content.text;
  }
  throw new Error("Expected text content");
}

describe("param-helpers", () => {
  describe("readStringParam", () => {
    it("should return string value when present", () => {
      const params = { name: "test" };
      const result = readStringParam(params, "name");
      expect(result).toBe("test");
    });

    it("should trim whitespace by default", () => {
      const params = { name: "  test  " };
      const result = readStringParam(params, "name");
      expect(result).toBe("test");
    });

    it("should not trim when trim is false", () => {
      const params = { name: "  test  " };
      const result = readStringParam(params, "name", { trim: false });
      expect(result).toBe("  test  ");
    });

    it("should return undefined for missing key", () => {
      const params = {};
      const result = readStringParam(params, "name");
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-string value", () => {
      const params = { name: 123 };
      const result = readStringParam(params, "name");
      expect(result).toBeUndefined();
    });

    it("should throw when required and missing", () => {
      const params = {};
      expect(() => readStringParam(params, "name", { required: true })).toThrow("name required");
    });

    it("should throw when required and not a string", () => {
      const params = { name: null };
      expect(() => readStringParam(params, "name", { required: true })).toThrow("name required");
    });

    it("should use custom label in error message", () => {
      const params = {};
      expect(() =>
        readStringParam(params, "name", { required: true, label: "Username" })
      ).toThrow("Username required");
    });

    it("should return undefined for empty string when not allowEmpty", () => {
      const params = { name: "" };
      const result = readStringParam(params, "name");
      expect(result).toBeUndefined();
    });

    it("should return empty string when allowEmpty is true", () => {
      const params = { name: "" };
      const result = readStringParam(params, "name", { allowEmpty: true });
      expect(result).toBe("");
    });

    it("should return undefined for whitespace-only when trimmed", () => {
      const params = { name: "   " };
      const result = readStringParam(params, "name");
      expect(result).toBeUndefined();
    });

    it("should throw for required empty string", () => {
      const params = { name: "" };
      expect(() => readStringParam(params, "name", { required: true })).toThrow("name required");
    });
  });

  describe("readNumberParam", () => {
    it("should return number value when present", () => {
      const params = { count: 42 };
      const result = readNumberParam(params, "count");
      expect(result).toBe(42);
    });

    it("should parse string numbers", () => {
      const params = { count: "42" };
      const result = readNumberParam(params, "count");
      expect(result).toBe(42);
    });

    it("should parse float numbers from string", () => {
      const params = { value: "3.14" };
      const result = readNumberParam(params, "value");
      expect(result).toBe(3.14);
    });

    it("should return undefined for missing key", () => {
      const params = {};
      const result = readNumberParam(params, "count");
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-numeric string", () => {
      const params = { count: "abc" };
      const result = readNumberParam(params, "count");
      expect(result).toBeUndefined();
    });

    it("should return undefined for NaN", () => {
      const params = { count: NaN };
      const result = readNumberParam(params, "count");
      expect(result).toBeUndefined();
    });

    it("should return undefined for Infinity", () => {
      const params = { count: Infinity };
      const result = readNumberParam(params, "count");
      expect(result).toBeUndefined();
    });

    it("should throw when required and missing", () => {
      const params = {};
      expect(() => readNumberParam(params, "count", { required: true })).toThrow("count required");
    });

    it("should throw when required and invalid", () => {
      const params = { count: "invalid" };
      expect(() => readNumberParam(params, "count", { required: true })).toThrow("count required");
    });

    it("should use custom label in error message", () => {
      const params = {};
      expect(() =>
        readNumberParam(params, "count", { required: true, label: "Item Count" })
      ).toThrow("Item Count required");
    });

    it("should truncate to integer when integer option is true", () => {
      const params = { count: 3.9 };
      const result = readNumberParam(params, "count", { integer: true });
      expect(result).toBe(3);
    });

    it("should truncate negative float to integer", () => {
      const params = { count: -3.9 };
      const result = readNumberParam(params, "count", { integer: true });
      expect(result).toBe(-3);
    });

    it("should handle empty string", () => {
      const params = { count: "" };
      const result = readNumberParam(params, "count");
      expect(result).toBeUndefined();
    });

    it("should handle whitespace-only string", () => {
      const params = { count: "   " };
      const result = readNumberParam(params, "count");
      expect(result).toBeUndefined();
    });

    it("should trim string before parsing", () => {
      const params = { count: "  42  " };
      const result = readNumberParam(params, "count");
      expect(result).toBe(42);
    });

    it("should return undefined for object value", () => {
      const params = { count: { value: 42 } };
      const result = readNumberParam(params, "count");
      expect(result).toBeUndefined();
    });

    it("should return undefined for array value", () => {
      const params = { count: [1, 2, 3] };
      const result = readNumberParam(params, "count");
      expect(result).toBeUndefined();
    });

    it("should handle zero correctly", () => {
      const params = { count: 0 };
      const result = readNumberParam(params, "count");
      expect(result).toBe(0);
    });

    it("should handle negative numbers", () => {
      const params = { count: -10 };
      const result = readNumberParam(params, "count");
      expect(result).toBe(-10);
    });
  });

  describe("jsonResult", () => {
    it("should return formatted JSON result", () => {
      const payload = { name: "test", value: 42 };
      const result = jsonResult(payload);

      expect(result.content).toHaveLength(1);
      const content = result.content[0];
      expect(content?.type).toBe("text");
      if (content?.type === "text") {
        expect(content.text).toBe(JSON.stringify(payload, null, 2));
      }
      expect(result.details).toBe(payload);
    });

    it("should handle array payload", () => {
      const payload = [1, 2, 3];
      const result = jsonResult(payload);

      expect(getTextContent(result)).toBe(JSON.stringify(payload, null, 2));
      expect(result.details).toBe(payload);
    });

    it("should handle string payload", () => {
      const payload = "simple string";
      const result = jsonResult(payload);

      expect(getTextContent(result)).toBe('"simple string"');
      expect(result.details).toBe(payload);
    });

    it("should handle null payload", () => {
      const result = jsonResult(null);

      expect(getTextContent(result)).toBe("null");
      expect(result.details).toBeNull();
    });

    it("should handle nested objects", () => {
      const payload = {
        user: { name: "test", settings: { theme: "dark" } },
        items: [1, 2, 3],
      };
      const result = jsonResult(payload);

      expect(getTextContent(result)).toContain("user");
      expect(getTextContent(result)).toContain("settings");
      expect(result.details).toBe(payload);
    });
  });
});
