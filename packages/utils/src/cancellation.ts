/**
 * Hierarchical cancellation token for coordinated operation cancellation.
 * Supports parent-child relationships where cancelling a parent cancels all children.
 */

/**
 * Error thrown when an operation is cancelled
 */
export class CancellationError extends Error {
  constructor(message = "Operation was cancelled") {
    super(message);
    this.name = "CancellationError";
  }
}

/**
 * A cancellation token that can be used to cancel async operations.
 * Supports hierarchical cancellation where cancelling a parent cancels all children.
 *
 * @example
 * ```typescript
 * // Create a root token
 * const rootToken = new CancellationToken();
 *
 * // Create child tokens for sub-operations
 * const childToken = rootToken.createChild();
 *
 * // Use the signal with fetch or other abortable APIs
 * fetch(url, { signal: childToken.signal });
 *
 * // Cancel all operations
 * rootToken.cancel();
 * ```
 */
export class CancellationToken {
  private readonly controller: AbortController;
  private readonly children: CancellationToken[] = [];
  private readonly _parent: CancellationToken | undefined;
  private readonly onCancelCallbacks: Array<() => void> = [];

  /**
   * Create a new cancellation token
   * @param parent Optional parent token - this token will be cancelled when parent is cancelled
   */
  constructor(parent?: CancellationToken) {
    this.controller = new AbortController();
    this._parent = parent;

    if (parent) {
      parent.children.push(this);

      // If parent is already cancelled, cancel immediately
      if (parent.isCancelled) {
        this.controller.abort();
      } else {
        // Cancel when parent is cancelled
        parent.signal.addEventListener(
          "abort",
          () => {
            this.cancel();
          },
          { once: true },
        );
      }
    }
  }

  /**
   * Get the parent token if any
   */
  get parent(): CancellationToken | undefined {
    return this._parent;
  }

  /**
   * Get the AbortSignal for use with fetch, timers, etc.
   */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Check if this token has been cancelled
   */
  get isCancelled(): boolean {
    return this.controller.signal.aborted;
  }

  /**
   * Cancel this token and all child tokens
   */
  cancel(): void {
    if (this.isCancelled) {
      return;
    }

    // Notify callbacks first
    for (const callback of this.onCancelCallbacks) {
      try {
        callback();
      } catch {
        // Ignore callback errors
      }
    }

    // Abort this token
    this.controller.abort();

    // Cancel all children
    for (const child of this.children) {
      child.cancel();
    }
  }

  /**
   * Create a child token that will be cancelled when this token is cancelled.
   * Child tokens can also be cancelled independently without affecting the parent.
   */
  createChild(): CancellationToken {
    return new CancellationToken(this);
  }

  /**
   * Throw CancellationError if this token has been cancelled.
   * Useful for checking cancellation at checkpoints in long-running operations.
   *
   * @example
   * ```typescript
   * for (const item of items) {
   *   token.throwIfCancelled();
   *   await processItem(item);
   * }
   * ```
   */
  throwIfCancelled(): void {
    if (this.isCancelled) {
      throw new CancellationError();
    }
  }

  /**
   * Register a callback to be called when this token is cancelled.
   * The callback is called synchronously during cancellation.
   *
   * @param callback Function to call on cancellation
   * @returns Function to unregister the callback
   */
  onCancel(callback: () => void): () => void {
    if (this.isCancelled) {
      // Already cancelled, call immediately
      try {
        callback();
      } catch {
        // Ignore callback errors
      }
      return () => {};
    }

    this.onCancelCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.onCancelCallbacks.indexOf(callback);
      if (index !== -1) {
        this.onCancelCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Wait for this token to be cancelled.
   * Useful for cleanup tasks that should run on cancellation.
   *
   * @example
   * ```typescript
   * // In a cleanup routine
   * await token.waitForCancellation();
   * cleanup();
   * ```
   */
  waitForCancellation(): Promise<void> {
    if (this.isCancelled) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  /**
   * Run an async function with this token's signal.
   * Throws CancellationError if cancelled before completion.
   *
   * @example
   * ```typescript
   * const result = await token.run(async (signal) => {
   *   const response = await fetch(url, { signal });
   *   return response.json();
   * });
   * ```
   */
  async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.throwIfCancelled();
    return fn(this.signal);
  }

  /**
   * Detach this token from its parent.
   * After detachment, cancelling the parent will not cancel this token.
   */
  detach(): void {
    if (this._parent) {
      const index = this._parent.children.indexOf(this);
      if (index !== -1) {
        this._parent.children.splice(index, 1);
      }
    }
  }
}

/**
 * Create a cancellation token that automatically cancels after a timeout
 *
 * @example
 * ```typescript
 * const token = withTimeout(5000); // Cancel after 5 seconds
 * await fetch(url, { signal: token.signal });
 * ```
 */
export function withTimeout(ms: number, parent?: CancellationToken): CancellationToken {
  const token = new CancellationToken(parent);

  const timeout = setTimeout(() => {
    token.cancel();
  }, ms);

  // Clear timeout if cancelled by other means
  token.onCancel(() => {
    clearTimeout(timeout);
  });

  return token;
}

/**
 * Create a cancellation token from an existing AbortSignal
 */
export function fromAbortSignal(signal: AbortSignal): CancellationToken {
  const token = new CancellationToken();

  if (signal.aborted) {
    token.cancel();
  } else {
    signal.addEventListener(
      "abort",
      () => {
        token.cancel();
      },
      { once: true },
    );
  }

  return token;
}

/**
 * Combine multiple cancellation tokens into one.
 * The combined token is cancelled when ANY of the source tokens is cancelled.
 *
 * @example
 * ```typescript
 * const userToken = new CancellationToken();
 * const timeoutToken = withTimeout(5000);
 * const combined = combineTokens(userToken, timeoutToken);
 * ```
 */
export function combineTokens(...tokens: CancellationToken[]): CancellationToken {
  const combined = new CancellationToken();

  for (const token of tokens) {
    if (token.isCancelled) {
      combined.cancel();
      break;
    }

    token.onCancel(() => {
      combined.cancel();
    });
  }

  return combined;
}
