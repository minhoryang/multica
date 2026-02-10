/**
 * Error type hierarchy for Multica agent system.
 * Provides typed errors with retry semantics and serialization support.
 */

/**
 * Base error class for all Multica errors.
 * Provides common functionality like error codes, retry semantics, and JSON serialization.
 */
export abstract class MulticaError extends Error {
  /** Unique error code for programmatic handling */
  abstract readonly code: string;

  /** Whether this error type is generally retryable */
  abstract readonly retryable: boolean;

  /** Timestamp when the error occurred */
  readonly timestamp = Date.now();

  /** Additional context about the error */
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error for logging or transmission
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      timestamp: this.timestamp,
      details: this.details,
      stack: this.stack,
    };
  }
}

// =============================================================================
// Network / API Errors
// =============================================================================

/**
 * General network connectivity error (DNS, TCP, TLS failures)
 */
export class NetworkError extends MulticaError {
  readonly code = "NETWORK_ERROR" as const;
  readonly retryable = true;
}

/**
 * Streaming connection was unexpectedly disconnected
 */
export class StreamDisconnectedError extends MulticaError {
  readonly code = "STREAM_DISCONNECTED" as const;
  readonly retryable = true;
}

/**
 * API rate limit exceeded
 */
export class RateLimitError extends MulticaError {
  readonly code = "RATE_LIMIT" as const;
  readonly retryable = true;

  /** Seconds to wait before retrying (from Retry-After header) */
  readonly retryAfter: number | undefined;

  constructor(message: string, retryAfter?: number, details?: Record<string, unknown>) {
    super(message, { ...details, retryAfter });
    this.retryAfter = retryAfter;
  }
}

/**
 * API returned an error response
 */
export class APIError extends MulticaError {
  readonly code = "API_ERROR" as const;

  /** HTTP status code if available */
  readonly statusCode: number | undefined;

  /** Whether this specific API error is retryable */
  readonly retryable: boolean;

  constructor(
    message: string,
    statusCode?: number,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message, { ...details, statusCode });
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

// =============================================================================
// Session / Storage Errors
// =============================================================================

/**
 * Failed to read or write session data
 */
export class SessionStorageError extends MulticaError {
  readonly code = "SESSION_STORAGE_ERROR" as const;
  readonly retryable = false;

  /** The session ID that failed */
  readonly sessionId: string | undefined;

  constructor(message: string, sessionId?: string, details?: Record<string, unknown>) {
    super(message, { ...details, sessionId });
    this.sessionId = sessionId;
  }
}

/**
 * Session data is corrupted or partially unreadable
 */
export class SessionCorruptedError extends MulticaError {
  readonly code = "SESSION_CORRUPTED" as const;
  readonly retryable = false;

  /** Number of entries that were successfully recovered */
  readonly recoveredEntries: number | undefined;

  /** Number of entries that were corrupted */
  readonly corruptedEntries: number | undefined;

  constructor(
    message: string,
    recoveredEntries?: number,
    corruptedEntries?: number,
    details?: Record<string, unknown>,
  ) {
    super(message, { ...details, recoveredEntries, corruptedEntries });
    this.recoveredEntries = recoveredEntries;
    this.corruptedEntries = corruptedEntries;
  }
}

// =============================================================================
// Compaction Errors
// =============================================================================

/**
 * General compaction operation failure
 */
export class CompactionError extends MulticaError {
  readonly code = "COMPACTION_ERROR" as const;
  readonly retryable = true;

  /** Compaction mode that failed */
  readonly mode: string | undefined;

  constructor(message: string, mode?: string, details?: Record<string, unknown>) {
    super(message, { ...details, mode });
    this.mode = mode;
  }
}

/**
 * Failed to generate conversation summary for compaction
 */
export class SummaryGenerationError extends MulticaError {
  readonly code = "SUMMARY_GENERATION_ERROR" as const;
  readonly retryable = true;

  /** Number of messages that were being summarized */
  readonly messagesCount: number | undefined;

  constructor(message: string, messagesCount?: number, details?: Record<string, unknown>) {
    super(message, { ...details, messagesCount });
    this.messagesCount = messagesCount;
  }
}

// =============================================================================
// Process Execution Errors
// =============================================================================

/**
 * Process execution exceeded timeout
 */
export class ProcessTimeoutError extends MulticaError {
  readonly code = "PROCESS_TIMEOUT" as const;
  readonly retryable = false;

  /** Timeout in milliseconds */
  readonly timeoutMs: number | undefined;

  /** Process ID if available */
  readonly pid: number | undefined;

  constructor(
    message: string,
    timeoutMs?: number,
    pid?: number,
    details?: Record<string, unknown>,
  ) {
    super(message, { ...details, timeoutMs, pid });
    this.timeoutMs = timeoutMs;
    this.pid = pid;
  }
}

/**
 * Process was killed by signal
 */
export class ProcessKilledError extends MulticaError {
  readonly code = "PROCESS_KILLED" as const;
  readonly retryable = false;

  /** Signal that killed the process */
  readonly signal: string | undefined;

  /** Process ID if available */
  readonly pid: number | undefined;

  constructor(
    message: string,
    signal?: string,
    pid?: number,
    details?: Record<string, unknown>,
  ) {
    super(message, { ...details, signal, pid });
    this.signal = signal;
    this.pid = pid;
  }
}

// =============================================================================
// Channel Errors
// =============================================================================

/**
 * Attempted to use a closed channel
 */
export class ChannelClosedError extends MulticaError {
  readonly code = "CHANNEL_CLOSED" as const;
  readonly retryable = false;
}

// =============================================================================
// Hub / Gateway Errors
// =============================================================================

/**
 * Failed to connect to gateway
 */
export class GatewayConnectionError extends MulticaError {
  readonly code = "GATEWAY_CONNECTION_ERROR" as const;
  readonly retryable = true;

  /** Gateway URL that failed */
  readonly url: string | undefined;

  constructor(message: string, url?: string, details?: Record<string, unknown>) {
    super(message, { ...details, url });
    this.url = url;
  }
}

/**
 * Failed to deliver message through gateway
 */
export class MessageDeliveryError extends MulticaError {
  readonly code = "MESSAGE_DELIVERY_ERROR" as const;
  readonly retryable = true;

  /** ID of the message that failed */
  readonly messageId: string | undefined;

  /** Target device ID */
  readonly targetDeviceId: string | undefined;

  constructor(
    message: string,
    messageId?: string,
    targetDeviceId?: string,
    details?: Record<string, unknown>,
  ) {
    super(message, { ...details, messageId, targetDeviceId });
    this.messageId = messageId;
    this.targetDeviceId = targetDeviceId;
  }
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an error is a MulticaError
 */
export function isMulticaError(error: unknown): error is MulticaError {
  return error instanceof MulticaError;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof MulticaError) {
    return error.retryable;
  }

  // Check for common transient error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("socket hang up") ||
      message.includes("fetch failed")
    );
  }

  return false;
}

/**
 * All Jakarta error codes for type-safe handling
 */
export type MulticaErrorCode =
  | "NETWORK_ERROR"
  | "STREAM_DISCONNECTED"
  | "RATE_LIMIT"
  | "API_ERROR"
  | "SESSION_STORAGE_ERROR"
  | "SESSION_CORRUPTED"
  | "COMPACTION_ERROR"
  | "SUMMARY_GENERATION_ERROR"
  | "PROCESS_TIMEOUT"
  | "PROCESS_KILLED"
  | "CHANNEL_CLOSED"
  | "GATEWAY_CONNECTION_ERROR"
  | "MESSAGE_DELIVERY_ERROR";
