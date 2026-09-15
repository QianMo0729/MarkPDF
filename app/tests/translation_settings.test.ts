import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: new Map<string, string>(), write: vi.fn() }));
vi.mock("../src/data/db/repos/syncState", () => ({
  getState: async (key: string) => state.values.get(key) ?? null,
  setState: state.write,
}));
vi.mock("../src/core/theme/theme", () => ({ applyTheme: vi.fn() }));
import { DEFAULT_SETTINGS, useSettings } from "../src/stores/settings";

beforeEach(() => {
  state.values.clear();
  state.write.mockReset().mockResolvedValue(undefined);
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: false });
});

describe("translation setting compatibility", () => {
  it("defaults to local translation and preserves the legacy AI configuration", async () => {
    state.values.set("llm_base_url", "https://existing.test/v1");
    state.values.set("llm_api_key", "dummy-key");
    state.values.set("llm_model", "existing-model");
    await useSettings.getState().load();
    expect(useSettings.getState().settings).toMatchObject({
      translationMode: "local", llmApiFormat: "openai", transcriptTranslationEnabled: false,
      llmBaseUrl: "https://existing.test/v1", llmApiKey: "dummy-key", llmModel: "existing-model",
    });
    expect(state.write).not.toHaveBeenCalled();
  });
  it("persists the opt-in transcript translation switch", async () => {
    await useSettings.getState().set("transcriptTranslationEnabled", true);
    expect(state.write).toHaveBeenCalledWith("transcript_translation_enabled", "1");
    state.values.set("transcript_translation_enabled", "1");
    await useSettings.getState().load();
    expect(useSettings.getState().settings.transcriptTranslationEnabled).toBe(true);
  });
  it("loads an explicitly selected AI backend and format", async () => {
    state.values.set("translation_mode", "ai");
    state.values.set("llm_api_format", "claude-messages");
    await useSettings.getState().load();
    expect(useSettings.getState().settings).toMatchObject({ translationMode: "ai", llmApiFormat: "claude-messages" });
  });
  it("falls back to safe defaults for invalid persisted choices", async () => {
    state.values.set("translation_mode", "unknown");
    state.values.set("llm_api_format", "unknown");
    await useSettings.getState().load();
    expect(useSettings.getState().settings).toMatchObject({ translationMode: "local", llmApiFormat: "openai" });
  });
  it("persists API format independently from translation mode", async () => {
    await useSettings.getState().set("llmApiFormat", "responses");
    expect(state.write).toHaveBeenCalledWith("llm_api_format", "responses");
    expect(useSettings.getState().settings.translationMode).toBe("local");
  });
  it("changing the sending format preserves the hand-entered URL, key and model", async () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, llmBaseUrl: "https://my-service.test/api", llmApiKey: "dummy-key", llmModel: "custom-model" } });
    await useSettings.getState().set("llmApiFormat", "claude-messages");
    expect(useSettings.getState().settings).toMatchObject({ llmBaseUrl: "https://my-service.test/api", llmApiKey: "dummy-key", llmModel: "custom-model" });
    expect(state.write).toHaveBeenCalledTimes(1);
    expect(state.write).toHaveBeenCalledWith("llm_api_format", "claude-messages");
  });
});
