import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { S } from "../../core/strings";
import { codexChat } from "../../platform/codex";
import { useSettings, type LlmApiFormat } from "../../stores/settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  signal?: AbortSignal;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("AI 服务未配置");
  }
}

export type LlmProtocol = Exclude<LlmApiFormat, "openai">;

export const LLM_FORMAT_LABELS = {
  openai: "OpenAI 格式",
  "claude-messages": "Claude 格式",
};

const ENDPOINTS: Record<LlmProtocol, string> = {
  "chat-completions": "/chat/completions",
  responses: "/responses",
  "claude-messages": "/messages",
};

/** Complete OpenAI endpoints take precedence; older stored format choices still work. */
export function getLlmProtocol(baseUrl: string, format: LlmApiFormat): LlmProtocol {
  if (format === "claude-messages") return format;
  try {
    const path = new URL(baseUrl.trim()).pathname.replace(/\/+$/, "");
    if (path.endsWith("/responses")) return "responses";
    if (path.endsWith("/chat/completions")) return "chat-completions";
  } catch { /* resolveLlmEndpoint supplies the actionable address error */ }
  return format === "responses" ? "responses" : "chat-completions";
}

/** Accept a host, an API base (including a proxy prefix), or a complete endpoint. */
export function resolveLlmEndpoint(baseUrl: string, format: LlmApiFormat): string {
  const protocol = format === "openai" ? getLlmProtocol(baseUrl, format) : format;
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error("AI 服务地址无效，请填写完整的 http:// 或 https:// 地址");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("AI 服务地址必须使用 http:// 或 https://");
  let path = url.pathname.replace(/\/+$/, "");
  const hasEndpoint = /\/(?:chat\/completions|responses|messages)$/.test(path);
  path = path.replace(/\/(?:chat\/completions|responses|messages)$/, "");
  url.pathname = `${path || (hasEndpoint ? "" : "/v1")}${ENDPOINTS[protocol]}`;
  url.hash = "";
  return url.toString();
}

function config() {
  const { llmBaseUrl, llmApiKey, llmModel, llmApiFormat } = useSettings.getState().settings;
  return {
    baseUrl: llmBaseUrl.trim(), apiKey: llmApiKey.trim(), model: llmModel.trim(),
    format: llmApiFormat ?? "chat-completions",
  };
}

function provider() {
  const { llmProvider, codexModel, codexEffort, codexPath } = useSettings.getState().settings;
  return { kind: llmProvider ?? "custom", codexModel: (codexModel ?? "").trim(), codexEffort: (codexEffort ?? "").trim(), codexPath: (codexPath ?? "").trim() };
}

/** Codex needs no address or key: the app-server holds the ChatGPT login. */
export function isLlmConfigured(): boolean {
  if (provider().kind === "codex") return true;
  const c = config();
  return !!(c.baseUrl && c.apiKey && c.model);
}

/** Codex is a stateless one-turn call: system prompt as base instructions, the rest joined as the user message. */
async function sendViaCodex(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const p = provider();
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversation = messages.filter((m) => m.role !== "system");
  const user = conversation.length === 1
    ? conversation[0].content
    : conversation.map((m) => (m.role === "assistant" ? `[assistant]\n${m.content}` : `[user]\n${m.content}`)).join("\n\n");
  const reply = await codexChat({ system: system || undefined, user, model: p.codexModel || undefined, effort: p.codexEffort || undefined, pathOverride: p.codexPath || undefined });
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const text = reply.text.trim();
  if (!text) throw new Error("接口没有返回文本内容");
  return text;
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function textBlocks(value: unknown, type: string): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    const block = object(item);
    return block.type === type && typeof block.text === "string" ? block.text : "";
  }).join("");
}

function errorDetail(data: unknown): string {
  const root = object(data);
  const err = root.error;
  if (typeof err === "string") return err;
  const message = object(err).message ?? root.message;
  return typeof message === "string" ? message : "";
}

export function parseLlmReply(data: unknown, format: LlmProtocol): string {
  const root = object(data);
  const apiError = errorDetail(data);
  if (root.error || root.status === "failed") throw new Error(apiError || "AI 服务返回失败状态");
  let content = "";
  let refusal = "";
  let truncated = false;
  if (format === "responses") {
    truncated = root.status === "incomplete";
    if (Array.isArray(root.output)) {
      content = root.output.map((item) => {
        const output = object(item);
        if (output.type !== "message") return "";
        if (Array.isArray(output.content)) {
          refusal += output.content.map((block) => {
            const part = object(block);
            return part.type === "refusal" && typeof part.refusal === "string" ? part.refusal : "";
          }).join("");
        }
        return textBlocks(output.content, "output_text");
      }).filter(Boolean).join("\n");
    }
    // Some compatible gateways flatten the SDK's output_text convenience value.
    if (!content && typeof root.output_text === "string") content = root.output_text;
  } else if (format === "claude-messages") {
    content = textBlocks(root.content, "text");
    truncated = root.stop_reason === "max_tokens";
  } else {
    const choice = object(Array.isArray(root.choices) ? root.choices[0] : undefined);
    const message = object(choice.message);
    content = typeof message.content === "string" ? message.content : textBlocks(message.content, "text");
    refusal = typeof message.refusal === "string" ? message.refusal : "";
    truncated = choice.finish_reason === "length";
  }
  if (truncated) throw new Error("AI 输出达到长度限制，未返回完整结果。请缩短选中文本后重试。");
  if (!content.trim()) throw new Error(refusal || "接口没有返回文本内容，请检查所选 API 格式和模型是否匹配");
  return content.trim();
}

class LlmHttpError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    const hint = status === 404 ? "。请核对 API 格式、服务地址和模型名称" : "";
    super(`${status} ${detail}${hint}`.trim());
  }
}

function unsupportedOpenAiEndpoint(error: unknown): boolean {
  if (!(error instanceof LlmHttpError)) return false;
  if (error.status === 405) return true;
  return error.status === 404 && !/\bmodel\b|模型/i.test(error.detail)
    && (!error.detail || /not found|unknown (route|path|endpoint)|unsupported (route|path|endpoint)|endpoint|route|接口|路由|路径/i.test(error.detail));
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (provider().kind === "codex") return sendViaCodex(messages, opts);
  const c = config();
  if (!c.baseUrl || !c.apiKey || !c.model) throw new LlmNotConfiguredError();
  const protocol = getLlmProtocol(c.baseUrl, c.format);
  try {
    return await sendRequest(c, protocol, messages, opts);
  } catch (error) {
    if (opts.signal?.aborted || protocol === "claude-messages" || !unsupportedOpenAiEndpoint(error)) throw error;
    // A route rejection cannot contain a generated answer. Try the other OpenAI
    // protocol once; do not switch on authentication, model, quota or server errors.
    return sendRequest(c, protocol === "responses" ? "chat-completions" : "responses", messages, opts);
  }
}

async function sendRequest(c: ReturnType<typeof config>, protocol: LlmProtocol, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const endpoint = resolveLlmEndpoint(c.baseUrl, protocol);
  const maxTokens = opts.maxTokens ?? 4096;
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversation = messages.filter((m) => m.role !== "system");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: JsonObject;
  if (protocol === "claude-messages") {
    headers["x-api-key"] = c.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = { model: c.model, messages: conversation, max_tokens: maxTokens, ...(system ? { system } : {}) };
  } else {
    headers.Authorization = `Bearer ${c.apiKey}`;
    body = protocol === "responses"
      ? { model: c.model, input: conversation, max_output_tokens: maxTokens, store: false, ...(system ? { instructions: system } : {}) }
      : { model: c.model, messages, max_completion_tokens: maxTokens };
  }
  // Sampling controls are deliberately omitted for every provider and every caller.
  // Reasoning models and many gateways reject non-default temperature values.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await tauriFetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (/error sending request|error trying to connect|connection refused|dns error/i.test(String(e))) {
        throw new Error(S.errors.llmUnreachable(new URL(endpoint).origin));
      }
      throw e;
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!res.ok) throw new LlmHttpError(res.status, res.statusText || "接口请求失败");
      throw new Error(`${res.status} 接口未返回有效 JSON，请检查 API 地址和格式`);
    }
    if (!res.ok) {
      const detail = errorDetail(data);
      // Older Chat Completions gateways only implement max_tokens. Retry only a
      // rejected parameter, never a successful generation or an authentication failure.
      if (attempt === 0 && protocol === "chat-completions" && [400, 422].includes(res.status)
        && /max_completion_tokens/i.test(detail) && /unsupported|unknown|unrecognized|not supported|not allowed|extra|不支持|未知/i.test(detail)) {
        delete body.max_completion_tokens;
        body.max_tokens = maxTokens;
        continue;
      }
      throw new LlmHttpError(res.status, detail || res.statusText);
    }
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return parseLlmReply(data, protocol);
  }
  throw new Error("AI 请求失败");
}

/** Use enough budget for reasoning models; an eight-token limit can hide valid replies. */
export async function testConnection(): Promise<string> {
  const reply = await chat([{ role: "user", content: "Reply with OK only." }], { maxTokens: 1024 });
  return reply.slice(0, 40);
}
