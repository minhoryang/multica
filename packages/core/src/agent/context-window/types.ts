/**
 * Context Window Guard - Type Definitions
 *
 * Used to manage and validate LLM context window limits
 */

/** Context window information source */
export type ContextWindowSource = "model" | "config" | "default";

/** Context window information */
export type ContextWindowInfo = {
  /** Token count */
  tokens: number;
  /** Source */
  source: ContextWindowSource;
};

/** Context window guard validation result */
export type ContextWindowGuardResult = ContextWindowInfo & {
  /** Whether warning is needed (window is small) */
  shouldWarn: boolean;
  /** Whether execution should be blocked (window is too small) */
  shouldBlock: boolean;
};

/** Token estimation result */
export type TokenEstimation = {
  /** Total message tokens */
  messageTokens: number;
  /** System prompt tokens */
  systemPromptTokens: number;
  /** Available tokens */
  availableTokens: number;
  /** Utilization ratio (0-1) */
  utilizationRatio: number;
};

/** Compaction result (with token information) */
export type TokenAwareCompactionResult = {
  /** Kept messages */
  kept: import("@mariozechner/pi-agent-core").AgentMessage[];
  /** Number of removed messages */
  removedCount: number;
  /** Tokens removed */
  tokensRemoved: number;
  /** Tokens kept */
  tokensKept: number;
};
