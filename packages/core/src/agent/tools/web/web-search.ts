import { createHmac } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { v7 as uuidv7 } from "uuid";

import { getHubId } from "../../../hub/hub-identity.js";
import {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  withTimeout,
  writeCache,
} from "./cache.js";
import type { CacheEntry } from "./cache.js";
import { jsonResult, readStringParam } from "./param-helpers.js";

const DEVV_SEARCH_ENDPOINT = "https://api-dev.copilothub.ai/web-search";
const SIGNING_KEY = "019c2d34-e8b2-75da-ace5-99f887c090c9";

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
});

type WebSearchArgs = {
  query: string;
};

type DevvSearchResponse = {
  items: Array<{
    title: string;
    link: string;
    displayLink: string;
    snippet: string;
  }>;
};

export type WebSearchResult = {
  query: string;
  tookMs: number;
  cached?: boolean;
  count: number;
  results: Array<{
    title: string;
    url: string;
    displayLink: string;
    snippet: string;
  }>;
};

function buildReqId(): string {
  const hubId = getHubId();
  const nonce = uuidv7();
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${hubId}.${nonce}.${timestamp}`;
  const signature = createHmac("sha256", SIGNING_KEY).update(message).digest("hex");
  return `${signature}.${hubId}.${nonce}.${timestamp}`;
}

async function runDevvSearch(params: {
  query: string;
  timeoutSeconds: number;
}): Promise<{
  results: Array<{
    title: string;
    url: string;
    displayLink: string;
    snippet: string;
  }>;
}> {
  const res = await fetch(DEVV_SEARCH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: params.query, reqId: buildReqId() }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Devv Search API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as DevvSearchResponse;
  const items = Array.isArray(data.items) ? data.items : [];

  return {
    results: items.map((item) => ({
      title: item.title ?? "",
      url: item.link ?? "",
      displayLink: item.displayLink ?? "",
      snippet: item.snippet ?? "",
    })),
  };
}

async function runWebSearch(params: {
  query: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(params.query);
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const start = Date.now();

  const { results } = await runDevvSearch({
    query: params.query,
    timeoutSeconds: params.timeoutSeconds,
  });

  const payload = {
    query: params.query,
    count: results.length,
    tookMs: Date.now() - start,
    results,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function createWebSearchTool(): AgentTool<typeof WebSearchSchema, unknown> {
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web via Devv Search. Returns a list of results with titles, URLs, and snippets.",
    parameters: WebSearchSchema,
    execute: async (_toolCallId, args) => {
      const params = args as WebSearchArgs;
      const query = readStringParam(params as Record<string, unknown>, "query", { required: true });

      try {
        const result = await runWebSearch({
          query,
          timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
          cacheTtlMs: DEFAULT_CACHE_TTL_MINUTES * 60_000,
        });
        return jsonResult(result);
      } catch (error) {
        return jsonResult({
          error: "search_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
