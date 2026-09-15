import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TranscriptSegmentRow } from "../src/data/db/schema";
import { TranscriptTranslationQueue } from "../src/features/session/controllers/transcriptTranslation";

function row(id: string, index = 0, sessionId = "recording-a"): TranscriptSegmentRow {
  return { id, session_id: sessionId, source: "device", t0_ms: index * 1000, t1_ms: (index + 1) * 1000, text: `Sentence ${id}.`, translation: null, lang: "en", page_index: 0, created_at: "", updated_at: "", dirty: 1 };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(mode: "local" | "ai" = "local") {
  const translate = vi.fn().mockResolvedValue("译文");
  const save = vi.fn().mockResolvedValue(undefined);
  const onState = vi.fn();
  const queue = new TranscriptTranslationQueue({ sessionId: "recording-a", target: "zh", mode, translate, save, onState });
  return { queue, translate, save, onState };
}

describe("finalized transcript translation queue", () => {
  it("starts with the latest sentence instead of sending the entire history", async () => {
    const { queue, translate, save } = setup();
    queue.observe([row("old-1", 0), row("old-2", 1), row("current", 2)]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(translate.mock.calls[0][1]).toBe("Sentence current.");
    expect(translate.mock.calls[0][4].pageText).toBeUndefined();
    queue.dispose();
  });

  it("serializes new finalized rows and never translates a row twice on database refresh", async () => {
    const { queue, translate, save } = setup();
    const first = deferred<string>();
    translate.mockReturnValueOnce(first.promise);
    queue.observe([]);
    const a = row("a"), b = row("b", 1), c = row("c", 2);
    queue.observe([a]);
    queue.observe([a, b, c]);
    queue.observe([a, b, c]);
    expect(translate).toHaveBeenCalledTimes(1);
    first.resolve("第一句");
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(translate.mock.calls.map((args) => args[1])).toEqual([a.text, b.text, c.text]);
    queue.observe([a, b, c]);
    expect(translate).toHaveBeenCalledTimes(3);
    queue.dispose();
  });

  it("gives AI at most the preceding three sentences and never future speech", async () => {
    const { queue, translate, save } = setup("ai");
    const rows = [0, 1, 2, 3, 4].map((i) => row(String(i), i));
    queue.observe(rows);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(translate.mock.calls[0][1]).toBe(rows[4].text);
    expect(translate.mock.calls[0][4]).toMatchObject({ pageText: rows.slice(1, 4).map((item) => item.text).join("\n"), contextKind: "transcript" });
    queue.dispose();
  });

  it("bounds context size for long prior segments", async () => {
    const { queue, translate, save } = setup("ai");
    queue.observe([{ ...row("long"), text: "x".repeat(1500) }, row("current", 1)]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(translate.mock.calls[0][4].pageText).toHaveLength(600);
    queue.dispose();
  });

  it("pauses after the first failure and only retries on an explicit request", async () => {
    const { queue, translate, save, onState } = setup();
    translate.mockRejectedValueOnce(new Error("model download failed"));
    queue.observe([]);
    const a = row("a"), b = row("b", 1), c = row("c", 2);
    queue.observe([a, b]);
    await waitFor(() => expect(onState.mock.calls.at(-1)?.[0].error?.message).toBe("model download failed"));
    queue.observe([a, b, c]);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    queue.retry();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(translate).toHaveBeenCalledTimes(4);
    queue.dispose();
  });

  it("disposal aborts a running translation and prevents late persistence or queued requests", async () => {
    const { queue, translate, save } = setup();
    const pending = deferred<string>();
    translate.mockReturnValueOnce(pending.promise);
    queue.observe([]);
    queue.observe([row("a"), row("b", 1)]);
    const signal = translate.mock.calls[0][4].signal;
    queue.dispose();
    expect(signal.aborted).toBe(true);
    pending.resolve("late translation");
    await pending.promise;
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("ignores stale session rows and does not overwrite a result completed elsewhere", async () => {
    const { queue, translate, save } = setup();
    const pending = deferred<string>();
    translate.mockReturnValueOnce(pending.promise);
    queue.observe([]);
    queue.observe([row("foreign", 0, "another-recording")]);
    expect(translate).not.toHaveBeenCalled();
    const a = row("a");
    queue.observe([a]);
    queue.observe([{ ...a, translation: "already saved" }]);
    pending.resolve("late translation");
    await pending.promise;
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    queue.dispose();
  });

  it("does not save a translation for source text that changed while it was running", async () => {
    const { queue, translate, save } = setup();
    const pending = deferred<string>();
    translate.mockReturnValueOnce(pending.promise);
    const a = row("a");
    queue.observe([a]);
    queue.observe([{ ...a, text: "Corrected sentence." }]);
    pending.resolve("stale translation");
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].text).toBe("Corrected sentence.");
    expect(save.mock.calls[0][1]).toBe("译文");
    queue.dispose();
  });
});
