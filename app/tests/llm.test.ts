import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmApiFormat } from "../src/stores/settings";

const mock = vi.hoisted(() => ({
  fetch: vi.fn(),
  settings: { llmBaseUrl: "https://api.example.com/v1", llmApiKey: "test-key", llmModel: "test-model", llmApiFormat: "chat-completions" as LlmApiFormat },
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mock.fetch }));
vi.mock("../src/stores/settings", () => ({ useSettings: { getState: () => ({ settings: mock.settings }) } }));

import { chat, getLlmProtocol, parseLlmReply, resolveLlmEndpoint, testConnection, type LlmProtocol } from "../src/data/api/llm";

const messages = [{ role: "system" as const, content: "Translate." }, { role: "user" as const, content: "Hello" }];
const replies: Record<LlmProtocol, unknown> = {
  "chat-completions": { choices: [{ message: { content: "你好" }, finish_reason: "stop" }] },
  responses: { status: "completed", output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: "你好" }] }] },
  "claude-messages": { content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "你好" }], stop_reason: "end_turn" },
};
function respond(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: status === 404 ? "Not Found" : "", json: async () => data };
}
function request(index = 0) {
  const [url, init] = mock.fetch.mock.calls[index];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body), signal: init.signal };
}

beforeEach(() => {
  mock.fetch.mockReset();
  Object.assign(mock.settings, { llmBaseUrl: "https://api.example.com/v1", llmApiKey: "test-key", llmModel: "test-model", llmApiFormat: "chat-completions" });
});

describe("AI protocols", () => {
  it("OpenAI follows a complete Responses URL and leaves saved configuration intact", async () => {
    mock.settings.llmApiFormat = "openai";
    mock.settings.llmBaseUrl = "https://custom.test/backend/responses";
    mock.fetch.mockResolvedValue(respond(replies.responses));
    await expect(chat(messages)).resolves.toBe("你好");
    expect(request().url).toBe("https://custom.test/backend/responses");
    expect(request().body).toHaveProperty("input");
    expect(request().body).not.toHaveProperty("messages");
    expect(mock.settings.llmBaseUrl).toBe("https://custom.test/backend/responses");
    expect(mock.settings.llmApiKey).toBe("test-key");
    expect(mock.settings.llmModel).toBe("test-model");
  });

  it.each([404, 405])("OpenAI tries Responses once if the Chat route rejects with HTTP %s", async (status) => {
    mock.settings.llmApiFormat = "openai";
    mock.fetch.mockResolvedValueOnce(respond({ error: { message: "Endpoint not found" } }, status))
      .mockResolvedValueOnce(respond(replies.responses));
    await expect(chat(messages)).resolves.toBe("你好");
    expect(mock.fetch).toHaveBeenCalledTimes(2);
    expect(request(0).url).toBe("https://api.example.com/v1/chat/completions");
    expect(request(1).url).toBe("https://api.example.com/v1/responses");
    expect(request(1).body).not.toHaveProperty("temperature");
  });

  it("can use Chat when a complete Responses route is unavailable", async () => {
    mock.settings.llmApiFormat = "openai";
    mock.settings.llmBaseUrl = "https://custom.test/v1/responses";
    mock.fetch.mockResolvedValueOnce(respond({ error: { message: "Endpoint not found" } }, 404))
      .mockResolvedValueOnce(respond(replies["chat-completions"]));
    await expect(chat(messages)).resolves.toBe("你好");
    expect(request(1).url).toBe("https://custom.test/v1/chat/completions");
  });

  it("never switches protocol when a model is missing", async () => {
    mock.settings.llmApiFormat = "openai";
    mock.fetch.mockResolvedValue(respond({ error: { message: "Model not found" } }, 404));
    await expect(chat(messages)).rejects.toThrow("Model not found");
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not switch a Claude-format request to another protocol", async () => {
    mock.settings.llmApiFormat = "claude-messages";
    mock.fetch.mockResolvedValue(respond({ error: { message: "Not Found" } }, 404));
    await expect(chat(messages)).rejects.toThrow("404");
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["chat-completions", "responses", "claude-messages"] as const)("uses the %s request shape with no sampling controls", async (format) => {
    mock.settings.llmApiFormat = format;
    mock.fetch.mockResolvedValue(respond(replies[format]));
    const signal = new AbortController().signal;
    await expect(chat(messages, { maxTokens: 500, signal })).resolves.toBe("你好");
    const req = request();
    expect(req.body).not.toHaveProperty("temperature");
    expect(req.body).not.toHaveProperty("top_p");
    expect(req.signal).toBe(signal);
    expect(req.body.model).toBe("test-model");
    if (format === "claude-messages") {
      expect(req.url).toBe("https://api.example.com/v1/messages");
      expect(req.headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2023-06-01" });
      expect(req.headers).not.toHaveProperty("Authorization");
      expect(req.body).toEqual({ model: "test-model", system: "Translate.", messages: [messages[1]], max_tokens: 500 });
    } else if (format === "responses") {
      expect(req.url).toBe("https://api.example.com/v1/responses");
      expect(req.headers.Authorization).toBe("Bearer test-key");
      expect(req.body).toEqual({ model: "test-model", instructions: "Translate.", input: [messages[1]], max_output_tokens: 500, store: false });
    } else {
      expect(req.url).toBe("https://api.example.com/v1/chat/completions");
      expect(req.headers.Authorization).toBe("Bearer test-key");
      expect(req.body).toEqual({ model: "test-model", messages, max_completion_tokens: 500 });
    }
  });

  it.each(["chat-completions", "responses", "claude-messages"] as const)("connection testing also omits temperature for %s", async (format) => {
    mock.settings.llmApiFormat = format;
    mock.fetch.mockResolvedValue(respond(replies[format]));
    await testConnection();
    expect(request().body).not.toHaveProperty("temperature");
  });

  it("only retries an explicitly unsupported Chat Completions token parameter", async () => {
    mock.fetch.mockResolvedValueOnce(respond({ error: { message: "Unknown parameter: max_completion_tokens" } }, 400))
      .mockResolvedValueOnce(respond(replies["chat-completions"]));
    await chat(messages);
    expect(mock.fetch).toHaveBeenCalledTimes(2);
    expect(request(1).body).toHaveProperty("max_tokens", 4096);
    expect(request(1).body).not.toHaveProperty("max_completion_tokens");
    expect(request(1).body).not.toHaveProperty("temperature");
  });

  it.each([401, 404, 429, 500])("surfaces HTTP %s without another billable request", async (status) => {
    mock.fetch.mockResolvedValue(respond({ error: { message: "service detail" } }, status));
    await expect(chat(messages)).rejects.toThrow(`${status} service detail`);
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });

  it("explains a non-JSON 404 instead of hiding the protocol mismatch", async () => {
    mock.fetch.mockResolvedValue({ ...respond(null, 404), json: async () => { throw new Error("HTML"); } });
    await expect(chat(messages)).rejects.toThrow("API 格式、服务地址和模型名称");
  });

  it("aborts before any request when already cancelled", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(chat(messages, { signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.fetch).not.toHaveBeenCalled();
  });
});

describe("endpoint normalization", () => {
  it("recognizes complete OpenAI endpoints and preserves legacy base-only choices", () => {
    expect(getLlmProtocol("https://host.test/v1", "openai")).toBe("chat-completions");
    expect(getLlmProtocol("https://host.test/v1", "responses")).toBe("responses");
    expect(getLlmProtocol("https://host.test/v1/chat/completions", "responses")).toBe("chat-completions");
    expect(getLlmProtocol("https://host.test/v1/responses", "openai")).toBe("responses");
  });
  it.each([
    ["https://api.openai.com", "responses", "https://api.openai.com/v1/responses"],
    ["https://host.test/v1/", "claude-messages", "https://host.test/v1/messages"],
    ["https://host.test/api/openai/v1", "responses", "https://host.test/api/openai/v1/responses"],
    ["http://localhost:8000/responses", "responses", "http://localhost:8000/responses"],
    ["https://host.test/v1/chat/completions/", "chat-completions", "https://host.test/v1/chat/completions"],
    ["https://host.test/v1/chat/completions", "responses", "https://host.test/v1/responses"],
    ["https://host.test/api?version=2", "claude-messages", "https://host.test/api/messages?version=2"],
  ])("resolves %s using %s", (input, format, expected) => {
    expect(resolveLlmEndpoint(input, format as LlmApiFormat)).toBe(expected);
  });
  it("rejects non-HTTP and missing protocol URLs", () => {
    expect(() => resolveLlmEndpoint("api.openai.com", "responses")).toThrow("地址无效");
    expect(() => resolveLlmEndpoint("file:///tmp", "responses")).toThrow("http://");
  });
});

describe("response boundaries", () => {
  it("joins only visible text blocks", () => {
    expect(parseLlmReply({ content: [{ type: "text", text: "你好" }, { type: "tool_use", name: "unused" }, { type: "text", text: "。" }] }, "claude-messages")).toBe("你好。");
  });
  it.each(["chat-completions", "responses", "claude-messages"] as const)("does not accept an unrelated shape for %s", (format) => {
    expect(() => parseLlmReply({}, format)).toThrow("没有返回文本");
  });
  it("does not show partial Responses output as a complete translation", () => {
    expect(() => parseLlmReply({ status: "incomplete", output_text: "部分" }, "responses")).toThrow("长度限制");
  });
  it("surfaces a Responses failure or refusal", () => {
    expect(() => parseLlmReply({ status: "failed", error: { message: "model unavailable" } }, "responses")).toThrow("model unavailable");
    expect(() => parseLlmReply({ output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot answer" }] }] }, "responses")).toThrow("Cannot answer");
  });
});
