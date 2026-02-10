/**
 * Retry utility with exponential backoff, jitter, and abort support.
 */

import { type MulticaError, isRetryableError, RateLimitError } from "./errors.js";

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;

  /** Base delay in milliseconds (default: 1000) */
  baseDelay?: number;

  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;

  /** Backoff multiplier (default: 2 for exponential) */
  backoffFactor?: number;

  /** Add randomness to delay to prevent thundering herd (default: true) */
  jitter?: boolean;

  /** Only retry errors with these codes (if specified) */
  retryableErrors?: string[];

  /** Abort signal to cancel retry loop */
  signal?: AbortSignal;

  /** Callback invoked before each retry */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  /** The successful result value */
  value: T;

  /** Number of attempts made (1 = success on first try) */
  attempts: number;

  /** Total time spent including delays */
  totalTimeMs: number;
}

/**
 * Error thrown when operation is aborted
 */
export class AbortError extends Error {
  constructor(message = "Operation aborted") {
    super(message);
    this.name = "AbortError";
  }
}

/**
 * Execute a function with automatic retry on failure.
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchData(),
 *   {
 *     maxAttempts: 3,
 *     baseDelay: 1000,
 *     onRetry: (err, attempt) => console.log(`Retry ${attempt}: ${err.message}`)
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const result = await withRetryResult(fn, options);
  return result.value;
}

/**
 * Execute a function with automatic retry, returning detailed result info.
 */
export async function withRetryResult<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    jitter = true,
    retryableErrors,
    signal,
    onRetry,
  } = options;

  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check for abort before each attempt
    if (signal?.aborted) {
      throw new AbortError();
    }

    try {
      const value = await fn();
      return {
        value,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const shouldRetry = isErrorRetryable(lastError, retryableErrors);

      if (!shouldRetry || attempt === maxAttempts) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      let delay = calculateDelay(attempt, baseDelay, maxDelay, backoffFactor);

      // Handle rate limit retry-after
      if (lastError instanceof RateLimitError && lastError.retryAfter) {
        delay = Math.max(delay, lastError.retryAfter * 1000);
      }

      // Add jitter
      if (jitter) {
        delay = addJitter(delay);
      }

      // Notify before retry
      onRetry?.(lastError, attempt, delay);

      // Wait before retrying
      await sleep(delay, signal);
    }
  }

  // Should not reach here, but TypeScript needs this
  throw lastError ?? new Error("Retry failed");
}

/**
 * Check if an error should be retried based on options
 */
function isErrorRetryable(error: Error, allowedCodes?: string[]): boolean {
  // If specific codes are provided, only retry those
  if (allowedCodes && allowedCodes.length > 0) {
    const jakartaError = error as MulticaError;
    if (jakartaError.code) {
      return allowedCodes.includes(jakartaError.code);
    }
    return false;
  }

  // Otherwise use default retryable check
  return isRetryableError(error);
}

/**
 * Calculate delay with exponential backoff
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  backoffFactor: number,
): number {
  const delay = baseDelay * Math.pow(backoffFactor, attempt - 1);
  return Math.min(delay, maxDelay);
}

/**
 * Add jitter to delay (±50%)
 */
function addJitter(delay: number): number {
  // Random value between 0.5 and 1.5
  const factor = 0.5 + Math.random();
  return Math.floor(delay * factor);
}

/**
 * Sleep for specified duration with abort support
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }

    const timeout = setTimeout(resolve, ms);

    const abortHandler = () => {
      clearTimeout(timeout);
      reject(new AbortError());
    };

    signal?.addEventListener("abort", abortHandler, { once: true });

    // Clean up abort listener after timeout completes
    setTimeout(() => {
      signal?.removeEventListener("abort", abortHandler);
    }, ms + 1);
  });
}

/**
 * Create a retry wrapper with preset options
 *
 * @example
 * ```typescript
 * const retryWithDefaults = createRetry({ maxAttempts: 5, baseDelay: 2000 });
 * const result = await retryWithDefaults(() => fetchData());
 * ```
 */
export function createRetry(
  defaultOptions: RetryOptions,
): <T>(fn: () => Promise<T>, options?: RetryOptions) => Promise<T> {
  return <T>(fn: () => Promise<T>, options?: RetryOptions) =>
    withRetry(fn, { ...defaultOptions, ...options });
}
