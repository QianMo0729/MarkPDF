import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ values: new Map<string, string>(), write: vi.fn() }));
vi.mock("../src/data/db/repos/syncState", () => ({ getState: async (key: string) => storage.values.get(key) ?? null, setState: storage.write }));
vi.mock("../src/core/theme/theme", () => ({ applyTheme: vi.fn() }));
import { DEFAULT_SETTINGS, useSettings } from "../src/stores/settings";

beforeEach(() => {
  storage.values.clear();
  storage.write.mockReset().mockResolvedValue(undefined);
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: false });
});

describe("context correction preference", () => {
  it("stays off for new and existing installations until explicitly enabled", async () => {
    storage.values.set("transcript_translation_enabled", "1");
    await useSettings.getState().load();
    expect(useSettings.getState().settings.transcriptCorrectionEnabled).toBe(false);
    expect(useSettings.getState().settings.transcriptTranslationEnabled).toBe(true);
    expect(storage.write).not.toHaveBeenCalled();
  });
  it("persists independently and restores on the next settings load", async () => {
    await useSettings.getState().set("transcriptCorrectionEnabled", true);
    expect(storage.write).toHaveBeenCalledWith("transcript_correction_enabled", "1");
    storage.values.set("transcript_correction_enabled", "1");
    await useSettings.getState().load();
    expect(useSettings.getState().settings.transcriptCorrectionEnabled).toBe(true);
    expect(useSettings.getState().settings.transcriptTranslationEnabled).toBe(false);
    await useSettings.getState().set("transcriptCorrectionEnabled", false);
    expect(storage.write).toHaveBeenLastCalledWith("transcript_correction_enabled", "0");
  });
});
