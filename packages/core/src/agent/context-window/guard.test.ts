import { describe, it, expect } from "vitest";
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  DEFAULT_CONTEXT_TOKENS,
  resolveContextWindowInfo,
  evaluateContextWindowGuard,
  checkContextWindow,
} from "./guard.js";

describe("guard", () => {
  describe("constants", () => {
    it("should have correct hard minimum tokens", () => {
      expect(CONTEXT_WINDOW_HARD_MIN_TOKENS).toBe(16_000);
    });

    it("should have correct warning threshold tokens", () => {
      expect(CONTEXT_WINDOW_WARN_BELOW_TOKENS).toBe(32_000);
    });

    it("should have correct default context tokens", () => {
      expect(DEFAULT_CONTEXT_TOKENS).toBe(200_000);
    });
  });

  describe("resolveContextWindowInfo", () => {
    it("should prioritize model context window", () => {
      const result = resolveContextWindowInfo({
        modelContextWindow: 100_000,
        configContextTokens: 50_000,
        defaultTokens: 200_000,
      });

      expect(result.tokens).toBe(100_000);
      expect(result.source).toBe("model");
    });

    it("should fall back to config when model is undefined", () => {
      const result = resolveContextWindowInfo({
        modelContextWindow: undefined,
        configContextTokens: 50_000,
        defaultTokens: 200_000,
      });

      expect(result.tokens).toBe(50_000);
      expect(result.source).toBe("config");
    });

    it("should fall back to default when both model and config are undefined", () => {
      const result = resolveContextWindowInfo({
        modelContextWindow: undefined,
        configContextTokens: undefined,
        defaultTokens: 150_000,
      });

      expect(result.tokens).toBe(150_000);
      expect(result.source).toBe("default");
    });

    it("should use DEFAULT_CONTEXT_TOKENS when no default provided", () => {
      const result = resolveContextWindowInfo({});

      expect(result.tokens).toBe(DEFAULT_CONTEXT_TOKENS);
      expect(result.source).toBe("default");
    });

    it("should ignore non-positive model values", () => {
      const result = resolveContextWindowInfo({
        modelContextWindow: 0,
        configContextTokens: 50_000,
      });

      expect(result.tokens).toBe(50_000);
      expect(result.source).toBe("config");
    });

    it("should ignore negative model values", () => {
      const result = resolveContextWindowInfo({
        modelContextWindow: -1000,
        configContextTokens: 50_000,
      });

      expect(result.tokens).toBe(50_000);
      expect(result.source).toBe("config");
    });

    it("should ignore NaN values", () => {
      const result = resolveContextWindowInfo({
        modelContextWindow: NaN,
        configContextTokens: NaN,
        defaultTokens: 100_000,
      });

      expect(result.tokens).toBe(100_000);
      expect(result.source).toBe("default");
    });

    it("should ignore Infinity values", () => {
      const result = resolveContextWindowInfo({
        modelContextWindow: Infinity,
        configContextTokens: 50_000,
      });

      expect(result.tokens).toBe(50_000);
      expect(result.source).toBe("config");
    });

    it("should floor decimal values", () => {
      const result = resolveContextWindowInfo({
        modelContextWindow: 100_000.9,
      });

      expect(result.tokens).toBe(100_000);
    });
  });

  describe("evaluateContextWindowGuard", () => {
    it("should not warn or block when tokens are high enough", () => {
      const result = evaluateContextWindowGuard({
        info: { tokens: 100_000, source: "model" },
      });

      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(false);
      expect(result.tokens).toBe(100_000);
      expect(result.source).toBe("model");
    });

    it("should warn but not block when tokens are between thresholds", () => {
      const result = evaluateContextWindowGuard({
        info: { tokens: 20_000, source: "config" },
      });

      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(false);
    });

    it("should both warn and block when tokens are below hard minimum", () => {
      const result = evaluateContextWindowGuard({
        info: { tokens: 10_000, source: "default" },
      });

      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(true);
    });

    it("should use custom thresholds", () => {
      const result = evaluateContextWindowGuard({
        info: { tokens: 5_000, source: "model" },
        warnBelowTokens: 10_000,
        hardMinTokens: 3_000,
      });

      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(false);
    });

    it("should block with custom hard minimum", () => {
      const result = evaluateContextWindowGuard({
        info: { tokens: 5_000, source: "model" },
        hardMinTokens: 8_000,
      });

      expect(result.shouldBlock).toBe(true);
    });

    it("should handle zero tokens", () => {
      const result = evaluateContextWindowGuard({
        info: { tokens: 0, source: "model" },
      });

      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(false);
      expect(result.tokens).toBe(0);
    });

    it("should floor negative tokens to zero", () => {
      const result = evaluateContextWindowGuard({
        info: { tokens: -1000, source: "model" },
      });

      expect(result.tokens).toBe(0);
    });

    it("should ensure minimum threshold of 1", () => {
      // When tokens is 5 and thresholds are floored to 1,
      // 5 >= 1 so shouldWarn and shouldBlock are false
      const result = evaluateContextWindowGuard({
        info: { tokens: 5, source: "model" },
        warnBelowTokens: 0,
        hardMinTokens: -100,
      });

      // 5 is not < 1, so neither warn nor block
      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(false);
    });

    it("should correctly apply floored threshold of 1", () => {
      // With tokens = 0, the condition (tokens > 0 && tokens < 1) is false
      // because tokens > 0 is false
      const result = evaluateContextWindowGuard({
        info: { tokens: 0, source: "model" },
        warnBelowTokens: 0,
        hardMinTokens: -100,
      });

      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(false);
    });
  });

  describe("checkContextWindow", () => {
    it("should combine resolution and evaluation", () => {
      const result = checkContextWindow({
        modelContextWindow: 100_000,
      });

      expect(result.tokens).toBe(100_000);
      expect(result.source).toBe("model");
      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(false);
    });

    it("should warn for low config tokens", () => {
      const result = checkContextWindow({
        configContextTokens: 25_000,
      });

      expect(result.tokens).toBe(25_000);
      expect(result.source).toBe("config");
      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(false);
    });

    it("should block for very low tokens", () => {
      const result = checkContextWindow({
        modelContextWindow: 8_000,
      });

      expect(result.shouldBlock).toBe(true);
    });

    it("should use all custom parameters", () => {
      const result = checkContextWindow({
        modelContextWindow: undefined,
        configContextTokens: undefined,
        defaultTokens: 50_000,
        warnBelowTokens: 60_000,
        hardMinTokens: 40_000,
      });

      expect(result.tokens).toBe(50_000);
      expect(result.source).toBe("default");
      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(false);
    });
  });
});
