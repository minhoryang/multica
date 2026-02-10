/**
 * Context Window Guard - Context Window Validation
 *
 * Validates context window sufficiency before agent runs to prevent token overflow
 */

import type { ContextWindowInfo, ContextWindowGuardResult, ContextWindowSource } from "./types.js";

/** Hard minimum token count, below which execution will be blocked */
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;

/** Warning threshold, below which a warning will be issued */
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

/** Default context window (when unable to obtain) */
export const DEFAULT_CONTEXT_TOKENS = 200_000;

/**
 * Normalize to positive integer
 */
function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const int = Math.floor(value);
  return int > 0 ? int : null;
}

/**
 * Resolve context window information
 *
 * Priority: model > config > default
 */
export function resolveContextWindowInfo(params: {
  /** Model's contextWindow property */
  modelContextWindow?: number | undefined;
  /** Context tokens specified in config */
  configContextTokens?: number | undefined;
  /** Default value */
  defaultTokens?: number | undefined;
}): ContextWindowInfo {
  // 1. Try getting from model
  const fromModel = normalizePositiveInt(params.modelContextWindow);
  if (fromModel) {
    return { tokens: fromModel, source: "model" };
  }

  // 2. Try getting from config
  const fromConfig = normalizePositiveInt(params.configContextTokens);
  if (fromConfig) {
    return { tokens: fromConfig, source: "config" };
  }

  // 3. Use default value
  return {
    tokens: Math.floor(params.defaultTokens ?? DEFAULT_CONTEXT_TOKENS),
    source: "default",
  };
}

/**
 * Evaluate context window guard
 *
 * Returns whether warning or blocking is needed
 */
export function evaluateContextWindowGuard(params: {
  info: ContextWindowInfo;
  warnBelowTokens?: number | undefined;
  hardMinTokens?: number | undefined;
}): ContextWindowGuardResult {
  const warnBelow = Math.max(
    1,
    Math.floor(params.warnBelowTokens ?? CONTEXT_WINDOW_WARN_BELOW_TOKENS),
  );
  const hardMin = Math.max(
    1,
    Math.floor(params.hardMinTokens ?? CONTEXT_WINDOW_HARD_MIN_TOKENS),
  );
  const tokens = Math.max(0, Math.floor(params.info.tokens));

  return {
    ...params.info,
    tokens,
    shouldWarn: tokens > 0 && tokens < warnBelow,
    shouldBlock: tokens > 0 && tokens < hardMin,
  };
}

/**
 * Complete context window guard workflow
 *
 * Resolution + evaluation in one step
 */
export function checkContextWindow(params: {
  modelContextWindow?: number | undefined;
  configContextTokens?: number | undefined;
  defaultTokens?: number | undefined;
  warnBelowTokens?: number | undefined;
  hardMinTokens?: number | undefined;
}): ContextWindowGuardResult {
  const info = resolveContextWindowInfo({
    modelContextWindow: params.modelContextWindow,
    configContextTokens: params.configContextTokens,
    defaultTokens: params.defaultTokens,
  });

  return evaluateContextWindowGuard({
    info,
    warnBelowTokens: params.warnBelowTokens,
    hardMinTokens: params.hardMinTokens,
  });
}
