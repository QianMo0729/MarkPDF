import { create } from "zustand";
import { applyTheme, type ThemePref } from "../core/theme/theme";
import { getState, setState } from "../data/db/repos/syncState";

/** Legacy explicit OpenAI protocol values remain readable for existing configurations. */
export type LlmApiFormat = "openai" | "chat-completions" | "responses" | "claude-messages";
export type TranslationMode = "local" | "ai";

export interface Settings {
  theme: ThemePref;
  localMode: boolean;
  viewMode: "single" | "continuous";
  zoomMode: string; // "page-width" | "page-fit" | number as string
  editorMode: "live" | "source" | "reading";
  translateTarget: "zh" | "en";
  translationMode: TranslationMode;
  transcriptTranslationEnabled: boolean;
  transcriptCorrectionEnabled: boolean;
  llmApiFormat: LlmApiFormat;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  highlightColor: string;
  inkColor: string;
  inkWidth: number;
  textBoxFontSize: number;
  /** Text box defaults; "" = no border / no fill. */
  textColor: string;
  textBoxBorderColor: string;
  textBoxFillColor: string;
  deleteWavAfterUpload: boolean;
  railCollapsed: boolean;
  railWidth: number;
  playbackSpeed: number;
  asrEnabled: boolean;
  langMode: "auto" | "zh" | "en";
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  localMode: true,
  viewMode: "single",
  zoomMode: "page-width",
  editorMode: "live",
  translateTarget: "zh",
  translationMode: "local",
  transcriptTranslationEnabled: false,
  transcriptCorrectionEnabled: false,
  llmApiFormat: "openai",
  llmBaseUrl: "",
  llmApiKey: "",
  llmModel: "",
  highlightColor: "#F5C542",
  inkColor: "#E5484D",
  inkWidth: 2,
  textBoxFontSize: 0,
  textColor: "#1B2130",
  textBoxBorderColor: "",
  textBoxFillColor: "",
  deleteWavAfterUpload: true,
  railCollapsed: false,
  railWidth: 96,
  playbackSpeed: 1,
  asrEnabled: true,
  langMode: "auto",
};

/** sync_state key for each setting (docs/SPEC.md 4.4). */
const KEYS: Record<keyof Settings, string> = {
  theme: "theme",
  localMode: "local_mode",
  viewMode: "view_mode",
  zoomMode: "zoom_mode",
  editorMode: "editor_mode",
  translateTarget: "translate_target",
  translationMode: "translation_mode",
  transcriptTranslationEnabled: "transcript_translation_enabled",
  transcriptCorrectionEnabled: "transcript_correction_enabled",
  llmApiFormat: "llm_api_format",
  llmBaseUrl: "llm_base_url",
  llmApiKey: "llm_api_key",
  llmModel: "llm_model",
  highlightColor: "highlight_color",
  inkColor: "ink_color",
  inkWidth: "ink_width",
  textBoxFontSize: "text_box_font_size",
  textColor: "text_color",
  textBoxBorderColor: "text_box_border_color",
  textBoxFillColor: "text_box_fill_color",
  deleteWavAfterUpload: "delete_wav_after_upload",
  railCollapsed: "rail_collapsed",
  railWidth: "rail_width",
  playbackSpeed: "playback_speed",
  asrEnabled: "asr_enabled",
  langMode: "lang_mode",
};

function encode(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function decode<K extends keyof Settings>(key: K, raw: string): Settings[K] {
  const def = DEFAULT_SETTINGS[key];
  if (key === "llmApiFormat" && !["openai", "chat-completions", "responses", "claude-messages"].includes(raw)) return def;
  if (key === "translationMode" && !["local", "ai"].includes(raw)) return def;
  if (typeof def === "boolean") return (raw === "1") as Settings[K];
  if (typeof def === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : def) as Settings[K];
  }
  return raw as Settings[K];
}

interface SettingsStore {
  loaded: boolean;
  settings: Settings;
  load: () => Promise<void>;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  loaded: false,
  settings: DEFAULT_SETTINGS,
  load: async () => {
    const next: Settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(KEYS) as (keyof Settings)[]) {
      const raw = await getState(KEYS[key]);
      if (raw !== null) (next as unknown as Record<string, unknown>)[key] = decode(key, raw);
    }
    applyTheme(next.theme);
    set({ settings: next, loaded: true });
  },
  set: async (key, value) => {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    if (key === "theme") applyTheme(value as ThemePref);
    await setState(KEYS[key], encode(value));
  },
}));

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSettings((s) => s.settings[key]);
}
