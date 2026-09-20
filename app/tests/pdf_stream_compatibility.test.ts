// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installStreamAsyncIterator } from "../src/pdf/streamCompatibility";

const prototype = ReadableStream.prototype;
const nativeIterator = Object.getOwnPropertyDescriptor(prototype, Symbol.asyncIterator)!;

beforeEach(() => {
  Reflect.deleteProperty(prototype, Symbol.asyncIterator);
});
afterEach(() => {
  Object.defineProperty(prototype, Symbol.asyncIterator, nativeIterator);
});

describe("PDF streams on pre-26.4 WebKit", () => {
  it("reads every chunk and releases the lock after EOF", async () => {
    installStreamAsyncIterator();
    const cancel = vi.fn();
    const stream = new ReadableStream<number>({
      start(controller) { controller.enqueue(1); controller.enqueue(2); controller.close(); },
      cancel,
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks).toEqual([1, 2]);
    expect(stream.locked).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("preserves native implementations and is idempotent", () => {
    Object.defineProperty(prototype, Symbol.asyncIterator, nativeIterator);
    installStreamAsyncIterator();
    expect(prototype[Symbol.asyncIterator]).toBe(nativeIterator.value);
    Reflect.deleteProperty(prototype, Symbol.asyncIterator);
    installStreamAsyncIterator();
    const installed = prototype[Symbol.asyncIterator];
    installStreamAsyncIterator();
    expect(prototype[Symbol.asyncIterator]).toBe(installed);
  });

  it("cancels and releases the lock when iteration stops early", async () => {
    installStreamAsyncIterator();
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(c) { c.enqueue(1); }, cancel });
    for await (const _chunk of stream) break;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it("can return before the first read without leaving a locked stream", async () => {
    installStreamAsyncIterator();
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.return!("stop");
    expect(cancel).toHaveBeenCalledWith("stop");
    expect(stream.locked).toBe(false);
  });

  it("supports preventCancel and serializes overlapping reads", async () => {
    installStreamAsyncIterator();
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(c) { c.enqueue(1); c.enqueue(2); c.enqueue(3); }, cancel,
    });
    const iterator = stream[Symbol.asyncIterator]({ preventCancel: true });
    expect(await Promise.all([iterator.next(), iterator.next(), iterator.return!()])).toEqual([
      { done: false, value: 1 }, { done: false, value: 2 }, { done: true, value: undefined },
    ]);
    expect(cancel).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
    const reader = stream.getReader();
    expect(await reader.read()).toEqual({ done: false, value: 3 });
    reader.releaseLock();
  });

  it("propagates read errors and releases the lock", async () => {
    installStreamAsyncIterator();
    const failure = new Error("stream failed");
    const stream = new ReadableStream({ start(c) { c.error(failure); } });
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it("releases the lock even if cancellation rejects", async () => {
    installStreamAsyncIterator();
    const failure = new Error("cancel failed");
    const stream = new ReadableStream({ cancel() { throw failure; } });
    await expect(stream[Symbol.asyncIterator]().return!()).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
  });
});
