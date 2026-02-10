/**
 * Go channel style async iterable queue.
 * Supports multiple writers, single reader, iteration ends after close.
 */
export class Channel<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private closed = false;

  private readers: Array<{
    resolve: (result: IteratorResult<T>) => void;
  }> = [];

  get isClosed(): boolean {
    return this.closed;
  }

  get size(): number {
    return this.buffer.length;
  }

  /** Send value to channel. Returns false when channel is closed. */
  send(value: T): boolean {
    if (this.closed) return false;

    const reader = this.readers.shift();
    if (reader) {
      reader.resolve({ value, done: false });
      return true;
    }

    this.buffer.push(value);
    return true;
  }

  /** Close channel, wake up all waiting readers. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    for (const reader of this.readers) {
      reader.resolve({ value: undefined as T, done: true });
    }
    this.readers = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          const value = this.buffer.shift()!;
          return Promise.resolve({ value, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.readers.push({ resolve });
        });
      },
    };
  }
}
