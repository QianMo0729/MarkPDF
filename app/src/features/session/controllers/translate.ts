import { create } from "zustand";
import { explainSystemPrompt, translateSystemPrompt } from "../../../core/prompts";
import { chat } from "../../../data/api/llm";
import { translateLocal } from "../../../data/translation/localTranslation";
import type { TranslationMode } from "../../../stores/settings";

export type TranslateAction = "translate" | "explain";

/** Local failures stay local. Only an explicit AI choice sends selected text to the API. */
export async function runTextAction(
  action: TranslateAction,
  text: string,
  target: "zh" | "en",
  mode: TranslationMode,
  opts: { signal?: AbortSignal; pageText?: string; contextKind?: "page" | "transcript"; onProgress?: (message: string) => void } = {},
): Promise<string> {
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (action === "translate" && mode === "local") {
    return translateLocal(text, target, { signal: opts.signal, onProgress: (progress) => opts.onProgress?.(progress.message) });
  }
  const prompt = action === "explain" ? explainSystemPrompt(target, opts.pageText) : translateSystemPrompt(target, opts.pageText, opts.contextKind);
  return chat([{ role: "system", content: prompt }, { role: "user", content: text }], { signal: opts.signal });
}

export interface TranslateRequest {
  text: string;
  action: TranslateAction;
  nonce: number;
}

export interface LlmHistoryItem {
  id: number;
  source: string;
  result: string;
  engine?: TranslationMode;
}

interface TranslateStore {
  /** Latest request from the selection toolbar; only the panel for `action` reacts. */
  request: TranslateRequest | null;
  history: Record<TranslateAction, LlmHistoryItem[]>;
  submit: (text: string, action: TranslateAction) => void;
  remember: (action: TranslateAction, item: Omit<LlmHistoryItem, "id">) => void;
  clear: (action: TranslateAction) => void;
}

let nextId = 1;

/** Bridges the selection toolbar and the translate / explain panels (docs/SPEC.md 6.5.10). */
export const useTranslateStore = create<TranslateStore>((set) => ({
  request: null,
  history: { translate: [], explain: [] },
  submit: (text, action) => set({ request: { text, action, nonce: Date.now() } }),
  remember: (action, item) =>
    set((s) => ({ history: { ...s.history, [action]: [{ id: nextId++, ...item }, ...s.history[action]].slice(0, 20) } })),
  clear: (action) =>
    set((s) => ({
      history: { ...s.history, [action]: [] },
      request: s.request?.action === action ? null : s.request,
    })),
}));
