/**
 * PDF.js consumes text streams with `for await`. WKWebView before Safari 26.4
 * has ReadableStream/getReader, but no async iterator (mozilla/pdf.js#20973).
 * Keep the native stream implementation and add only the missing iterator.
 */
export function installStreamAsyncIterator(Stream = globalThis.ReadableStream): void {
  if (!Stream || Symbol.asyncIterator in Stream.prototype) return;

  Object.defineProperty(Stream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: function <T>(this: ReadableStream<T>, { preventCancel = false } = {}) {
      const reader = this.getReader();
      let finished = false;
      // Serialize next/return calls just like the native stream iterator.
      let pending: Promise<unknown> = Promise.resolve();
      const enqueue = (operation: () => Promise<IteratorResult<T>>) => {
        const result = pending.then(operation);
        pending = result.catch(() => {});
        return result;
      };
      return {
        [Symbol.asyncIterator]() { return this; },
        next(): Promise<IteratorResult<T>> {
          return enqueue(async () => {
            if (finished) return { done: true, value: undefined };
            try {
              const result = await reader.read();
              if (result.done) {
                finished = true;
                reader.releaseLock();
                return { done: true, value: undefined };
              }
              return { done: false, value: result.value };
            } catch (error) {
              finished = true;
              reader.releaseLock();
              throw error;
            }
          });
        },
        return(value?: unknown): Promise<IteratorResult<T>> {
          return enqueue(async () => {
            if (!finished) {
              finished = true;
              try {
                if (!preventCancel) await reader.cancel(value);
              } finally {
                reader.releaseLock();
              }
            }
            return { done: true, value };
          });
        },
      };
    },
  });
}

installStreamAsyncIterator();
