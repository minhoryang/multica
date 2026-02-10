import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveTimeoutSeconds,
  resolveCacheTtlMs,
  normalizeCacheKey,
  readCache,
  writeCache,
  withTimeout,
  type CacheEntry,
} from "./cache.js";

describe("cache", () => {
  describe("resolveTimeoutSeconds", () => {
    it("should return the value if it is a valid number", () => {
      expect(resolveTimeoutSeconds(30, 10)).toBe(30);
      expect(resolveTimeoutSeconds(60, 10)).toBe(60);
    });

    it("should return fallback for non-number values", () => {
      expect(resolveTimeoutSeconds("30", 10)).toBe(10);
      expect(resolveTimeoutSeconds(null, 10)).toBe(10);
      expect(resolveTimeoutSeconds(undefined, 10)).toBe(10);
      expect(resolveTimeoutSeconds({}, 10)).toBe(10);
    });

    it("should return fallback for non-finite numbers", () => {
      expect(resolveTimeoutSeconds(NaN, 10)).toBe(10);
      expect(resolveTimeoutSeconds(Infinity, 10)).toBe(10);
      expect(resolveTimeoutSeconds(-Infinity, 10)).toBe(10);
    });

    it("should enforce minimum of 1 second", () => {
      expect(resolveTimeoutSeconds(0, 10)).toBe(1);
      expect(resolveTimeoutSeconds(-5, 10)).toBe(1);
      expect(resolveTimeoutSeconds(0.5, 10)).toBe(1);
    });

    it("should floor decimal values", () => {
      expect(resolveTimeoutSeconds(5.9, 10)).toBe(5);
      expect(resolveTimeoutSeconds(10.1, 5)).toBe(10);
    });
  });

  describe("resolveCacheTtlMs", () => {
    it("should convert minutes to milliseconds", () => {
      expect(resolveCacheTtlMs(1, 15)).toBe(60_000);
      expect(resolveCacheTtlMs(15, 15)).toBe(900_000);
      expect(resolveCacheTtlMs(60, 15)).toBe(3_600_000);
    });

    it("should return fallback for non-number values", () => {
      expect(resolveCacheTtlMs("15", 15)).toBe(900_000);
      expect(resolveCacheTtlMs(null, 10)).toBe(600_000);
      expect(resolveCacheTtlMs(undefined, 5)).toBe(300_000);
    });

    it("should handle zero and negative values", () => {
      expect(resolveCacheTtlMs(0, 15)).toBe(0);
      expect(resolveCacheTtlMs(-5, 15)).toBe(0);
    });

    it("should handle fractional minutes", () => {
      expect(resolveCacheTtlMs(0.5, 15)).toBe(30_000);
      expect(resolveCacheTtlMs(1.5, 15)).toBe(90_000);
    });
  });

  describe("normalizeCacheKey", () => {
    it("should trim whitespace", () => {
      expect(normalizeCacheKey("  key  ")).toBe("key");
      expect(normalizeCacheKey("\tkey\n")).toBe("key");
    });

    it("should lowercase the key", () => {
      expect(normalizeCacheKey("KEY")).toBe("key");
      expect(normalizeCacheKey("MyKey")).toBe("mykey");
      expect(normalizeCacheKey("HTTPS://EXAMPLE.COM")).toBe("https://example.com");
    });

    it("should handle empty string", () => {
      expect(normalizeCacheKey("")).toBe("");
      expect(normalizeCacheKey("   ")).toBe("");
    });
  });

  describe("readCache", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return null for missing key", () => {
      const cache = new Map<string, CacheEntry<string>>();
      expect(readCache(cache, "missing")).toBeNull();
    });

    it("should return cached value if not expired", () => {
      const cache = new Map<string, CacheEntry<string>>();
      const now = Date.now();
      cache.set("key", {
        value: "test-value",
        expiresAt: now + 60_000,
        insertedAt: now,
      });

      const result = readCache(cache, "key");
      expect(result).toEqual({ value: "test-value", cached: true });
    });

    it("should return null and delete expired entries", () => {
      const cache = new Map<string, CacheEntry<string>>();
      const now = Date.now();
      cache.set("key", {
        value: "test-value",
        expiresAt: now - 1000, // expired
        insertedAt: now - 60_000,
      });

      const result = readCache(cache, "key");
      expect(result).toBeNull();
      expect(cache.has("key")).toBe(false);
    });

    it("should delete entry when exactly at expiration time", () => {
      const cache = new Map<string, CacheEntry<string>>();
      const now = Date.now();
      cache.set("key", {
        value: "test-value",
        expiresAt: now,
        insertedAt: now - 60_000,
      });

      vi.advanceTimersByTime(1); // Move past expiration
      const result = readCache(cache, "key");
      expect(result).toBeNull();
    });
  });

  describe("writeCache", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should write entry with correct expiration", () => {
      const cache = new Map<string, CacheEntry<string>>();
      const now = Date.now();

      writeCache(cache, "key", "value", 60_000);

      const entry = cache.get("key");
      expect(entry).toBeDefined();
      expect(entry?.value).toBe("value");
      expect(entry?.expiresAt).toBe(now + 60_000);
      expect(entry?.insertedAt).toBe(now);
    });

    it("should not write if ttl is 0 or negative", () => {
      const cache = new Map<string, CacheEntry<string>>();

      writeCache(cache, "key1", "value1", 0);
      writeCache(cache, "key2", "value2", -100);

      expect(cache.size).toBe(0);
    });

    it("should evict oldest entry when cache is full", () => {
      const cache = new Map<string, CacheEntry<string>>();
      const now = Date.now();

      // Fill up to max (100 entries)
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, {
          value: `value${i}`,
          expiresAt: now + 60_000,
          insertedAt: now,
        });
      }

      expect(cache.size).toBe(100);

      // Add one more - should evict first
      writeCache(cache, "new-key", "new-value", 60_000);

      expect(cache.size).toBe(100);
      expect(cache.has("key0")).toBe(false);
      expect(cache.has("new-key")).toBe(true);
    });

    it("should overwrite existing entry", () => {
      const cache = new Map<string, CacheEntry<string>>();

      writeCache(cache, "key", "value1", 60_000);
      writeCache(cache, "key", "value2", 60_000);

      expect(cache.size).toBe(1);
      expect(cache.get("key")?.value).toBe("value2");
    });
  });

  describe("withTimeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return aborted signal after timeout", async () => {
      const signal = withTimeout(undefined, 1000);

      expect(signal.aborted).toBe(false);

      vi.advanceTimersByTime(1000);

      expect(signal.aborted).toBe(true);
    });

    it("should abort immediately if timeout is 0", () => {
      const signal = withTimeout(undefined, 0);
      expect(signal.aborted).toBe(false);
    });

    it("should abort when parent signal aborts", () => {
      const parentController = new AbortController();
      const signal = withTimeout(parentController.signal, 60_000);

      expect(signal.aborted).toBe(false);

      parentController.abort();

      expect(signal.aborted).toBe(true);
    });

    it("should clear timeout when parent signal aborts", () => {
      const parentController = new AbortController();
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      withTimeout(parentController.signal, 60_000);
      parentController.abort();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });
});
