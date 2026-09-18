import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRow } from "../src/data/db/schema";
import { Timeline } from "../src/domain/timeline";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(async () => true),
  getSession: vi.fn(),
  updateSession: vi.fn(async () => undefined),
  listEvents: vi.fn(async () => []),
  replaceDeviceSegments: vi.fn(async (_id: string, rows: unknown[]) => rows),
  transcribe: vi.fn(),
  cancel: vi.fn(async () => true),
  readyDirFor: vi.fn(async () => "C:/models/zh"),
  recording: { sessionId: null as string | null, status: "idle", starting: false },
  settings: { langMode: "auto", asrModelZh: "", asrModelEn: "" },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: mocks.exists }));
vi.mock("../src/data/db/repos/sessions", () => ({ getSession: mocks.getSession, updateSession: mocks.updateSession }));
vi.mock("../src/data/db/repos/events", () => ({ listEvents: mocks.listEvents }));
vi.mock("../src/data/db/repos/transcripts", () => ({ replaceDeviceSegments: mocks.replaceDeviceSegments }));
vi.mock("../src/data/files/file_store", () => ({ sessionWavPath: async (id: string) => `C:/wav/${id}.wav` }));
vi.mock("../src/platform/asr", () => ({
  asrTranscribeFile: mocks.transcribe,
  asrTranscribeCancel: mocks.cancel,
  onAsrTranscribeProgress: async () => () => undefined,
}));
vi.mock("../src/stores/settings", () => ({ useSettings: { getState: () => ({ settings: mocks.settings }) } }));
vi.mock("../src/features/settings/modelManager", () => ({ useModelManager: { getState: () => ({ loaded: true, load: async () => undefined, readyDirFor: mocks.readyDirFor }) } }));
vi.mock("../src/features/session/controllers/recording", () => ({ useRecording: { getState: () => mocks.recording } }));

import { NoModelError, segmentsWithPages, useRetranscribe } from "../src/features/session/controllers/retranscribe";

const session = { id: "s1", started_at: "2026-09-16T00:00:00Z", duration_ms: 10_000, initial_page_index: 2, lang_mode: "zh", local_wav_path: null } as unknown as SessionRow;

beforeEach(() => {
  mocks.getSession.mockReset().mockResolvedValue(session);
  mocks.transcribe.mockReset();
  mocks.replaceDeviceSegments.mockClear();
  mocks.updateSession.mockClear();
  mocks.readyDirFor.mockReset().mockResolvedValue("C:/models/zh");
  mocks.recording.sessionId = null;
  mocks.recording.status = "idle";
  useRetranscribe.setState({ jobs: {} });
});

describe("segmentsWithPages", () => {
  it("attaches each segment to the page open at its start and drops empty text", () => {
    const timeline = new Timeline({ events: [{ id: "e1", type: "page_change", t_ms: 4000, payload: { page_index: 5 } }], initialPageIndex: 2, durationMs: 10_000 });
    const rows = segmentsWithPages([{ t0_ms: 1000, t1_ms: 3000, text: " 第一句 " }, { t0_ms: 4500, t1_ms: 6000, text: "second" }, { t0_ms: 7000, t1_ms: 8000, text: "  " }], timeline);
    expect(rows).toEqual([
      { t0_ms: 1000, t1_ms: 3000, text: "第一句", page_index: 2 },
      { t0_ms: 4500, t1_ms: 6000, text: "second", page_index: 5 },
    ]);
    expect(segmentsWithPages([{ t0_ms: 0, t1_ms: 1, text: "x" }], null)[0].page_index).toBeNull();
  });
});

describe("re-transcribe a recording", () => {
  it("decodes the WAV with the ready model for the session language, replaces the device transcript and marks the session", async () => {
    mocks.transcribe.mockResolvedValue({ segments: [{ t0_ms: 0, t1_ms: 900, text: "hello" }], audio_ms: 10_000, load_ms: 1, decode_ms: 2 });
    await useRetranscribe.getState().start("s1");
    expect(mocks.readyDirFor).toHaveBeenCalledWith("zh", { zh: "", en: "" });
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(String), "C:/models/zh", "C:/wav/s1.wav");
    expect(mocks.replaceDeviceSegments).toHaveBeenCalledWith("s1", [{ t0_ms: 0, t1_ms: 900, text: "hello", page_index: 2 }]);
    expect(mocks.updateSession).toHaveBeenCalledWith("s1", { asr_status: "device" });
    expect(useRetranscribe.getState().jobs.s1).toMatchObject({ status: "done", segments: 1 });
  });

  it("refuses while that recording is still running, and without a model", async () => {
    mocks.recording.sessionId = "s1";
    mocks.recording.status = "recording";
    await expect(useRetranscribe.getState().start("s1")).rejects.toThrow("录音仍在进行");
    mocks.recording.status = "idle";
    mocks.readyDirFor.mockResolvedValue(null);
    await expect(useRetranscribe.getState().start("s1")).rejects.toBeInstanceOf(NoModelError);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("keeps the old transcript when decoding fails or is cancelled", async () => {
    mocks.transcribe.mockRejectedValueOnce(new Error("expected a 16 kHz WAV"));
    await expect(useRetranscribe.getState().start("s1")).rejects.toThrow("16 kHz");
    expect(mocks.replaceDeviceSegments).not.toHaveBeenCalled();
    expect(useRetranscribe.getState().jobs.s1?.status).toBe("error");
    useRetranscribe.getState().dismiss("s1");
    expect(useRetranscribe.getState().jobs.s1).toBeUndefined();
    mocks.transcribe.mockRejectedValueOnce("cancelled");
    await useRetranscribe.getState().start("s1");
    expect(useRetranscribe.getState().jobs.s1).toBeUndefined();
    expect(mocks.replaceDeviceSegments).not.toHaveBeenCalled();
  });
});
