import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmApiFormat, LlmProvider } from "../src/stores/settings";

const mock = vi.hoisted(() => ({
  fetch: vi.fn(),
  codexChat: vi.fn(),
  settings: {
    llmProvider: "custom" as LlmProvider,
    llmBaseUrl: "https://api.example.com/v1", llmApiKey: "test-key", llmModel: "test-model", llmApiFormat: "chat-completions" as LlmApiFormat,
    codexModel: "gpt-5.6-sol", codexEffort: "low", codexPath: "",
  },
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mock.fetch }));
vi.mock("../src/platform/codex", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/platform/codex")>()), codexChat: mock.codexChat }));
vi.mock("../src/stores/settings", () => ({ useSettings: { getState: () => ({ settings: mock.settings }) } }));

import { chat, isLlmConfigured, testConnection } from "../src/data/api/llm";
import { describeRateLimits, effortFor, usableCodexModels, type CodexModel } from "../src/platform/codex";

beforeEach(() => {
  mock.fetch.mockReset();
  mock.codexChat.mockReset();
  mock.settings.llmProvider = "custom";
});

describe("AI provider: ChatGPT account through Codex", () => {
  it("routes chat through the Codex app-server with the saved model and effort, never through HTTP", async () => {
    mock.settings.llmProvider = "codex";
    mock.codexChat.mockResolvedValue({ text: " 你好 ", model: "gpt-5.6-sol" });
    await expect(chat([{ role: "system", content: "Translate." }, { role: "user", content: "Hello" }])).resolves.toBe("你好");
    expect(mock.fetch).not.toHaveBeenCalled();
    expect(mock.codexChat).toHaveBeenCalledWith({ system: "Translate.", user: "Hello", model: "gpt-5.6-sol", effort: "low", pathOverride: undefined });
  });

  it("is configured without a base URL or key, and falls back to the custom API when selected", async () => {
    mock.settings.llmProvider = "codex";
    mock.settings.llmBaseUrl = "";
    expect(isLlmConfigured()).toBe(true);
    mock.settings.llmProvider = "custom";
    expect(isLlmConfigured()).toBe(false);
    mock.settings.llmBaseUrl = "https://api.example.com/v1";
    expect(isLlmConfigured()).toBe(true);
  });

  it("surfaces Codex errors and empty replies, and honours an aborted signal", async () => {
    mock.settings.llmProvider = "codex";
    mock.codexChat.mockRejectedValueOnce(new Error("codex app-server exited"));
    await expect(chat([{ role: "user", content: "x" }])).rejects.toThrow("codex app-server exited");
    mock.codexChat.mockResolvedValueOnce({ text: "   ", model: "m" });
    await expect(chat([{ role: "user", content: "x" }])).rejects.toThrow("没有返回文本内容");
    const controller = new AbortController();
    controller.abort();
    await expect(chat([{ role: "user", content: "x" }], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.codexChat).toHaveBeenCalledTimes(2);
  });

  it("joins a multi-turn conversation into one user message for the stateless turn", async () => {
    mock.settings.llmProvider = "codex";
    mock.codexChat.mockResolvedValue({ text: "ok", model: "m" });
    await chat([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }]);
    expect(mock.codexChat.mock.calls[0][0].user).toBe("[user]\na\n\n[assistant]\nb\n\n[user]\nc");
  });

  it("testConnection works for Codex too", async () => {
    mock.settings.llmProvider = "codex";
    mock.codexChat.mockResolvedValue({ text: "OK", model: "m" });
    await expect(testConnection()).resolves.toBe("OK");
  });
});

const models: CodexModel[] = [
  { id: "b", model: "b", displayName: "B", description: "", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "high", description: "" }], defaultReasoningEffort: "low", inputModalities: ["text"], isDefault: false },
  { id: "hidden", model: "hidden", displayName: "H", description: "", hidden: true, supportedReasoningEfforts: [], defaultReasoningEffort: "medium", inputModalities: ["text"], isDefault: false },
  { id: "a", model: "a", displayName: "A", description: "", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }], defaultReasoningEffort: "medium", inputModalities: ["text"], isDefault: true },
];

describe("Codex catalog helpers", () => {
  it("hides hidden models and puts the default first", () => {
    expect(usableCodexModels(models).map((m) => m.id)).toEqual(["a", "b"]);
  });
  it("keeps a saved effort only when the model supports it", () => {
    expect(effortFor(models[0], "high")).toBe("high");
    expect(effortFor(models[0], "ultra")).toBe("low");
    expect(effortFor(undefined, "xhigh")).toBe("xhigh");
  });
  it("reads the primary window of account/rateLimits/read in both shapes", () => {
    const nested = describeRateLimits({ rateLimits: { primary: { usedPercent: 75, windowDurationMins: 10080, resetsAt: 1789805540 } } });
    expect(nested?.usedPercent).toBe(75);
    expect(nested?.windowMins).toBe(10080);
    expect(nested?.resetsAt?.getTime()).toBe(1789805540 * 1000);
    expect(describeRateLimits({ primary: { usedPercent: 10 } })?.usedPercent).toBe(10);
    expect(describeRateLimits({})).toBeNull();
    expect(describeRateLimits(null)).toBeNull();
  });
});
