import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ local: vi.fn(), ai: vi.fn() }));
vi.mock("../src/data/translation/localTranslation", () => ({ translateLocal: mocks.local }));
vi.mock("../src/data/api/llm", () => ({ chat: mocks.ai }));
import { runTextAction } from "../src/features/session/controllers/translate";

beforeEach(() => {
  mocks.local.mockReset().mockResolvedValue("本地译文");
  mocks.ai.mockReset().mockResolvedValue("AI 译文");
});

describe("translation routing", () => {
  it("uses the local model without calling AI", async () => {
    await expect(runTextAction("translate", "hello", "zh", "local")).resolves.toBe("本地译文");
    expect(mocks.local).toHaveBeenCalledWith("hello", "zh", expect.any(Object));
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("does not send text to AI when the local model fails", async () => {
    mocks.local.mockRejectedValue(new Error("download interrupted"));
    await expect(runTextAction("translate", "private notes", "en", "local")).rejects.toThrow("download interrupted");
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("uses AI only after an explicit AI choice", async () => {
    await expect(runTextAction("translate", "hello", "zh", "ai")).resolves.toBe("AI 译文");
    expect(mocks.local).not.toHaveBeenCalled();
    expect(mocks.ai).toHaveBeenCalledWith(expect.arrayContaining([{ role: "user", content: "hello" }]), expect.any(Object));
  });
  it("explanation uses AI with its page context, independent of local translation preference", async () => {
    await runTextAction("explain", "hello", "zh", "local", { pageText: "course context" });
    expect(mocks.local).not.toHaveBeenCalled();
    expect(mocks.ai.mock.calls[0][0][0].content).toContain("course context");
  });
  it("keeps prior speech in AI context and explicitly translates only the current sentence", async () => {
    await runTextAction("translate", "Current sentence", "zh", "ai", { pageText: "Previous sentence", contextKind: "transcript" });
    const messages = mocks.ai.mock.calls[0][0];
    expect(messages[0].content).toContain("Previous sentence");
    expect(messages[0].content).toContain("只输出用户消息中当前句的译文");
    expect(messages[1]).toEqual({ role: "user", content: "Current sentence" });
  });
  it("passes cancellation and model progress through to the panel", async () => {
    const signal = new AbortController().signal;
    const onProgress = vi.fn();
    mocks.local.mockImplementation(async (_text, _target, opts) => {
      expect(opts.signal).toBe(signal);
      opts.onProgress({ message: "下载模型中" });
      return "译文";
    });
    await runTextAction("translate", "hello", "zh", "local", { signal, onProgress });
    expect(onProgress).toHaveBeenCalledWith("下载模型中");
  });
  it("does not launch either backend after cancellation", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(runTextAction("translate", "hello", "zh", "local", { signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.local).not.toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});
