import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Wrappers over src-tauri/src/codex (docs/SPEC.md 16.3): "Sign in with ChatGPT" via the Codex app-server. */

export interface CodexInfo {
  path: string;
  version: string;
}

export interface CodexAccount {
  type: "chatgpt" | "apiKey" | "amazonBedrock" | string;
  email?: string | null;
  planType?: string | null;
}

export interface CodexStatus {
  info: CodexInfo;
  account: CodexAccount | null;
  requires_openai_auth: boolean;
}

export interface CodexEffortOption {
  reasoningEffort: string;
  description: string;
}

/** One entry of Codex `model/list`; only the fields MarkPDF shows are typed. */
export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: CodexEffortOption[];
  defaultReasoningEffort: string;
  inputModalities: string[];
  isDefault: boolean;
}

export interface CodexLoginStart {
  login_id: string;
  auth_url: string;
}

export interface CodexLoginResult {
  login_id: string;
  success: boolean;
  error: string | null;
}

export interface CodexChatReply {
  text: string;
  model: string;
}

export const codexLocate = (pathOverride?: string) => invoke<CodexInfo>("codex_locate", { pathOverride: pathOverride || null });
export const codexStatus = (pathOverride?: string) => invoke<CodexStatus>("codex_status", { pathOverride: pathOverride || null });
export const codexLoginStart = (pathOverride?: string) => invoke<CodexLoginStart>("codex_login_start", { pathOverride: pathOverride || null });
export const codexLoginCancel = (loginId: string) => invoke<void>("codex_login_cancel", { loginId });
export const codexLogout = () => invoke<void>("codex_logout");
export const codexModels = (pathOverride?: string) => invoke<CodexModel[]>("codex_models", { pathOverride: pathOverride || null });
export const codexRateLimits = () => invoke<unknown>("codex_rate_limits");
export const codexShutdown = () => invoke<void>("codex_shutdown");

export function codexChat(request: { system?: string; user: string; model?: string; effort?: string; pathOverride?: string }): Promise<CodexChatReply> {
  return invoke<CodexChatReply>("codex_chat", {
    request: { system: request.system ?? null, user: request.user, model: request.model || null, effort: request.effort || null, path_override: request.pathOverride || null },
  });
}

export function onCodexLogin(cb: (result: CodexLoginResult) => void): Promise<UnlistenFn> {
  return listen<CodexLoginResult>("codex://login", (e) => cb(e.payload));
}

/** Visible models with a non-empty effort list, default first, then Codex's order. */
export function usableCodexModels(models: CodexModel[]): CodexModel[] {
  return models.filter((m) => !m.hidden).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** The effort to send for a model: the saved one if the model supports it, otherwise the model's default. */
export function effortFor(model: CodexModel | undefined, saved: string): string {
  if (!model) return saved;
  const supported = model.supportedReasoningEfforts.map((e) => e.reasoningEffort);
  return supported.includes(saved) ? saved : model.defaultReasoningEffort;
}

/** "本周已用 75%，9月23日 重置" from `account/rateLimits/read`; null when the shape is unknown. */
export function describeRateLimits(raw: unknown): { usedPercent: number; resetsAt: Date | null; windowMins: number | null } | null {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const limits = root && typeof root.rateLimits === "object" && root.rateLimits ? (root.rateLimits as Record<string, unknown>) : root;
  const primary = limits && typeof limits.primary === "object" && limits.primary ? (limits.primary as Record<string, unknown>) : null;
  if (!primary || typeof primary.usedPercent !== "number") return null;
  const resets = typeof primary.resetsAt === "number" ? new Date(primary.resetsAt * (primary.resetsAt < 1e12 ? 1000 : 1)) : null;
  return { usedPercent: primary.usedPercent, resetsAt: resets, windowMins: typeof primary.windowDurationMins === "number" ? primary.windowDurationMins : null };
}
