/**
 * Summary-based Compaction
 *
 * Uses LLM to generate summaries of historical messages instead of simple truncation
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { generateSummary, estimateTokens } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { estimateMessagesTokens } from "./token-estimation.js";

/** Summary compaction result */
export type SummaryCompactionResult = {
  /** Kept messages (including summary message) */
  kept: AgentMessage[];
  /** Number of removed messages */
  removedCount: number;
  /** Tokens removed */
  tokensRemoved: number;
  /** Tokens kept */
  tokensKept: number;
  /** Generated summary */
  summary: string;
  /** Compaction reason */
  reason: "summary";
};

/** Summary compaction parameters */
export type SummaryCompactionParams = {
  /** Message list */
  messages: AgentMessage[];
  /** LLM Model (for generating summary) */
  model: Model<any>;
  /** API Key */
  apiKey: string;
  /** Available tokens */
  availableTokens: number;
  /** Target utilization ratio (0-1), defaults to 0.5 */
  targetRatio?: number | undefined;
  /** Minimum messages to keep, defaults to 10 */
  minKeepMessages?: number | undefined;
  /** Tokens reserved for summary generation, defaults to 2048 */
  reserveTokens?: number | undefined;
  /** Custom summary instructions */
  customInstructions?: string | undefined;
  /** Previous summary (for incremental update) */
  previousSummary?: string | undefined;
  /** AbortSignal */
  signal?: AbortSignal | undefined;
};

/** 默认摘要提示词 */
const DEFAULT_SUMMARY_INSTRUCTIONS = `Summarize the conversation history concisely, focusing on:
- Key decisions made
- Important context and constraints
- Open questions or TODOs
- Technical details that may be needed later

Keep the summary concise but complete. Use bullet points for clarity.`;

/**
 * Split messages into parts to summarize and parts to keep
 */
export function splitMessagesForSummary(
  messages: AgentMessage[],
  availableTokens: number,
  options?: {
    targetRatio?: number | undefined;
    minKeepMessages?: number | undefined;
  },
): { toSummarize: AgentMessage[]; toKeep: AgentMessage[] } | null {
  const targetRatio = options?.targetRatio ?? 0.5;
  const minKeep = options?.minKeepMessages ?? 10;

  if (messages.length <= minKeep) {
    return null; // Too few messages, no compression needed
  }

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = Math.floor(availableTokens * targetRatio);

  // If already within target, no compression needed
  if (totalTokens <= targetTokens) {
    return null;
  }

  // Keep messages from back to front
  const toKeep: AgentMessage[] = [];
  let keptTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const msgTokens = estimateTokens(msg);

    // Check if this message can be added
    if (keptTokens + msgTokens <= targetTokens || toKeep.length < minKeep) {
      toKeep.unshift(msg);
      keptTokens += msgTokens;
    }

    // If minimum keep count reached and exceeds target, stop
    if (toKeep.length >= minKeep && keptTokens >= targetTokens) {
      break;
    }
  }

  // Messages to summarize
  const toSummarize = messages.slice(0, messages.length - toKeep.length);

  if (toSummarize.length === 0) {
    return null;
  }

  return { toSummarize, toKeep };
}

/**
 * Create summary message
 */
function createSummaryMessage(summary: string, previousSummary?: string): AgentMessage {
  const content = previousSummary
    ? `## Previous Context Summary\n${previousSummary}\n\n## Recent Context Summary\n${summary}`
    : `## Conversation Summary\n${summary}`;

  return {
    role: "user",
    content: `[System Note: The following is a summary of the earlier conversation history that has been compacted to save context space.]\n\n${content}\n\n[End of Summary]`,
    timestamp: Date.now(),
  };
}

/**
 * Execute summary-based compaction
 *
 * Uses LLM to generate summary of historical messages, then combines summary with recent messages
 */
export async function compactMessagesWithSummary(
  params: SummaryCompactionParams,
): Promise<SummaryCompactionResult | null> {
  const {
    messages,
    model,
    apiKey,
    availableTokens,
    targetRatio,
    minKeepMessages,
    reserveTokens = 2048,
    customInstructions,
    previousSummary,
    signal,
  } = params;

  // 分割消息
  const split = splitMessagesForSummary(messages, availableTokens, {
    targetRatio,
    minKeepMessages,
  });

  if (!split) {
    return null;
  }

  const { toSummarize, toKeep } = split;

  // Generate summary
  const instructions = customInstructions || DEFAULT_SUMMARY_INSTRUCTIONS;
  const summary = await generateSummary(
    toSummarize,
    model,
    reserveTokens,
    apiKey,
    signal,
    instructions,
    previousSummary,
  );

  // Create summary message
  const summaryMessage = createSummaryMessage(summary, previousSummary);

  // Combine results
  const kept = [summaryMessage, ...toKeep];

  const tokensRemoved = estimateMessagesTokens(toSummarize);
  const tokensKept = estimateMessagesTokens(kept);

  return {
    kept,
    removedCount: toSummarize.length,
    tokensRemoved,
    tokensKept,
    summary,
    reason: "summary",
  };
}

/**
 * Generate summary in chunks (for very large history)
 *
 * When history is too large, generate summaries by chunks then merge
 */
export async function compactMessagesWithChunkedSummary(
  params: SummaryCompactionParams & {
    maxChunkTokens?: number | undefined;
  },
): Promise<SummaryCompactionResult | null> {
  const {
    messages,
    model,
    apiKey,
    availableTokens,
    targetRatio,
    minKeepMessages,
    reserveTokens = 2048,
    customInstructions,
    previousSummary,
    signal,
    maxChunkTokens = 50000,
  } = params;

  // Split messages
  const split = splitMessagesForSummary(messages, availableTokens, {
    targetRatio,
    minKeepMessages,
  });

  if (!split) {
    return null;
  }

  const { toSummarize, toKeep } = split;

  // If messages to summarize are not many, summarize directly
  const toSummarizeTokens = estimateMessagesTokens(toSummarize);
  if (toSummarizeTokens <= maxChunkTokens) {
    return compactMessagesWithSummary(params);
  }

  // Process in chunks
  const chunks: AgentMessage[][] = [];
  let currentChunk: AgentMessage[] = [];
  let currentTokens = 0;

  for (const msg of toSummarize) {
    const msgTokens = estimateTokens(msg);

    if (currentTokens + msgTokens > maxChunkTokens && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(msg);
    currentTokens += msgTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // Generate summary for each chunk
  const instructions = customInstructions || DEFAULT_SUMMARY_INSTRUCTIONS;
  const chunkSummaries: string[] = [];

  let runningContext = previousSummary;
  for (const chunk of chunks) {
    const chunkSummary = await generateSummary(
      chunk,
      model,
      reserveTokens,
      apiKey,
      signal,
      instructions,
      runningContext,
    );
    chunkSummaries.push(chunkSummary);
    runningContext = chunkSummary;
  }

  // Final summary is the last chunk's summary (already includes previous context)
  const finalSummary = chunkSummaries[chunkSummaries.length - 1] ?? "";

  // Create summary message
  const summaryMessage = createSummaryMessage(finalSummary);

  // Combine results
  const kept = [summaryMessage, ...toKeep];

  const tokensRemoved = estimateMessagesTokens(toSummarize);
  const tokensKept = estimateMessagesTokens(kept);

  return {
    kept,
    removedCount: toSummarize.length,
    tokensRemoved,
    tokensKept,
    summary: finalSummary,
    reason: "summary",
  };
}
