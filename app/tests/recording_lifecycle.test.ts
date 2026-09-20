import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsrFinal, AsrStatus } from "../src/platform/asr";
import type { SessionRow } from "../src/data/db/schema";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), updateSession: vi.fn(), appendEvent: vi.fn(), insertDeviceSegment: vi.fn(),
  audioStart: vi.fn(), audioStop: vi.fn(), audioStatus: vi.fn(), asrStart: vi.fn(), asrStop: vi.fn(),
  readyDirFor: vi.fn(), loadModels: vi.fn(), flush: vi.fn(), toast: vi.fn(),
  settings: {asrEnabled: false, langMode: "mixed"},
  nativeState: "idle",
  finals: new Set<(seg: AsrFinal) => void>(),
  statuses: new Set<(status: AsrStatus) => void>(),
  partials: new Set<(text: string) => void>(),
}));

vi.mock("../src/core/ui/Toast", () => ({toast: mocks.toast}));
vi.mock("../src/core/asrModels", () => ({modelForLang: () => ({id: "model"})}));
vi.mock("../src/data/db/repos/sessions", () => ({getSession: mocks.getSession, updateSession: mocks.updateSession}));
vi.mock("../src/data/db/repos/events", () => ({appendEvent: mocks.appendEvent}));
vi.mock("../src/data/db/repos/transcripts", () => ({insertDeviceSegment: mocks.insertDeviceSegment}));
vi.mock("../src/data/files/file_store", () => ({sessionWavPath: async (id: string) => `C:/test-only/${id}.wav`}));
vi.mock("../src/stores/settings", () => ({useSettings: {getState: () => ({settings: mocks.settings})}}));
vi.mock("../src/features/settings/modelManager", () => ({useModelManager: {getState: () => ({
  loaded: true, verifying: new Set(), load: mocks.loadModels, readyDirFor: mocks.readyDirFor,
})}}));
vi.mock("../src/features/session/controllers/noteEditor", () => ({useNoteEditor: {
  getState: () => ({flush: mocks.flush}), setState: vi.fn(),
}}));
vi.mock("../src/features/session/controllers/annotations", () => ({useAnnotationStore: {setState: vi.fn()}}));
vi.mock("../src/platform/audio", () => ({
  audioStart: mocks.audioStart, audioStop: mocks.audioStop, audioStatus: mocks.audioStatus,
  audioPause: vi.fn(), audioResume: vi.fn(),
  onAudioTick: async () => vi.fn(), onAudioLevel: async () => vi.fn(), onAudioState: async () => vi.fn(),
}));
vi.mock("../src/platform/asr", () => ({
  asrStart: mocks.asrStart, asrStop: mocks.asrStop,
  onAsrFinal: async (callback: (seg: AsrFinal) => void) => {
    mocks.finals.add(callback); return () => { mocks.finals.delete(callback); };
  },
  onAsrStatus: async (callback: (status: AsrStatus) => void) => {
    mocks.statuses.add(callback); return () => { mocks.statuses.delete(callback); };
  },
  onAsrPartial: async (callback: (text: string) => void) => {
    mocks.partials.add(callback); return () => { mocks.partials.delete(callback); };
  },
}));

const emptySession = (id = "session-a") => ({
  id, deck_id: id === "session-b" ? "pdf-b" : "pdf-a", started_at: null, ended_at: null, local_wav_path: null,
} as SessionRow);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {resolve = done;});
  return {promise, resolve};
}

async function settle() {
  for (let count = 0; count < 25; count++) await Promise.resolve();
}

let useRecording: typeof import("../src/features/session/controllers/recording")["useRecording"];
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  mocks.finals.clear(); mocks.partials.clear(); mocks.statuses.clear();
  mocks.settings.asrEnabled = false;
  mocks.nativeState = "idle";
  mocks.getSession.mockReset().mockImplementation(async (id: string) => emptySession(id));
  mocks.updateSession.mockReset().mockResolvedValue(undefined);
  mocks.appendEvent.mockReset().mockResolvedValue(undefined);
  mocks.insertDeviceSegment.mockReset().mockResolvedValue(undefined);
  mocks.audioStart.mockReset().mockImplementation(async () => {mocks.nativeState = "recording";});
  mocks.audioStop.mockReset().mockImplementation(async () => {mocks.nativeState = "idle"; return {duration_ms: 1200};});
  mocks.audioStatus.mockReset().mockImplementation(async () => ({state: mocks.nativeState, t_ms: 1200}));
  mocks.asrStart.mockReset().mockResolvedValue(undefined);
  mocks.asrStop.mockReset().mockResolvedValue(undefined);
  mocks.readyDirFor.mockReset().mockResolvedValue("C:/test-only/asr-model");
  mocks.loadModels.mockReset().mockResolvedValue(undefined);
  mocks.flush.mockReset().mockResolvedValue(undefined);
  ({useRecording} = await import("../src/features/session/controllers/recording"));
  useRecording.getState().attach("session-a", "pdf-a");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("recording lifecycle protects saved audio", () => {
  const savedRecording = {
    ...emptySession(), started_at: "2026-09-15T00:00:00Z", ended_at: "2026-09-15T00:01:00Z",
    local_wav_path: "C:/existing.wav", duration_ms: 60000, initial_page_index: 2,
  };

  it("explicitly appends at the native duration while preserving the original start and page", async () => {
    mocks.getSession.mockResolvedValue(savedRecording);
    mocks.audioStatus.mockResolvedValue({state: "recording", t_ms: 61000});
    await useRecording.getState().start(7, {append: true});
    expect(mocks.audioStart).toHaveBeenCalledWith("C:/existing.wav", true);
    expect(mocks.updateSession).toHaveBeenCalledWith("session-a", {
      ended_at: null, duration_ms: 61000, audio_status: "recording", local_wav_path: "C:/existing.wav",
    });
    expect(mocks.appendEvent.mock.calls).toEqual([
      ["session-a", "recording_state", 61000, {state: "resumed"}],
      ["session-a", "page_change", 61000, {page_index: 7}],
    ]);
    expect(useRecording.getState()).toMatchObject({status: "recording", tMs: 61000});
    mocks.audioStop.mockResolvedValue({duration_ms: 65000});
    await useRecording.getState().stop();
    expect(mocks.updateSession).toHaveBeenLastCalledWith("session-a", expect.objectContaining({duration_ms: 65000, audio_status: "local"}));
  });

  it("leaves saved metadata untouched when the original WAV cannot be opened", async () => {
    mocks.getSession.mockResolvedValue(savedRecording);
    mocks.audioStart.mockRejectedValue(new Error("file not found"));
    await useRecording.getState().start(7, {append: true});
    expect(mocks.audioStart).toHaveBeenCalledWith("C:/existing.wav", true);
    expect(mocks.updateSession).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(useRecording.getState()).toMatchObject({status: "idle", tMs: 60000, starting: false});
  });

  it("preserves both the original recording and newly captured audio if append startup fails", async () => {
    mocks.getSession.mockResolvedValue(savedRecording);
    mocks.audioStatus.mockResolvedValue({state: "recording", t_ms: 60000});
    mocks.audioStop.mockResolvedValue({duration_ms: 60500});
    mocks.appendEvent.mockRejectedValueOnce(new Error("event write failed"));
    await useRecording.getState().start(7, {append: true});
    expect(mocks.audioStop).toHaveBeenCalledOnce();
    expect(mocks.updateSession).toHaveBeenLastCalledWith("session-a", expect.objectContaining({
      started_at: savedRecording.started_at, initial_page_index: 2, duration_ms: 60500,
      local_wav_path: savedRecording.local_wav_path, audio_status: "local", ended_at: expect.any(String),
    }));
    expect(useRecording.getState().status).toBe("idle");
  });

  it.each([
    {...savedRecording, local_wav_path: null},
    {...savedRecording, started_at: null},
    {...savedRecording, deck_id: "another-pdf"},
  ])("refuses to append an unavailable or unrelated recording", async (saved) => {
    mocks.getSession.mockResolvedValue(saved);
    await useRecording.getState().start(7, {append: true});
    expect(mocks.audioStart).not.toHaveBeenCalled();
    expect(mocks.updateSession).not.toHaveBeenCalled();
    expect(useRecording.getState().status).toBe("idle");
  });

  it.each([
    ["started timestamp", {...emptySession(), started_at: "2026-09-15T00:00:00Z"}],
    ["ended timestamp", {...emptySession(), ended_at: "2026-09-15T00:00:00Z"}],
    ["existing WAV path", {...emptySession(), local_wav_path: "C:/existing.wav"}],
    ["missing session", null],
  ])("does not open or truncate audio for a %s", async (_, session) => {
    mocks.getSession.mockResolvedValue(session);
    await useRecording.getState().start(2);
    expect(mocks.audioStart).not.toHaveBeenCalled();
    expect(mocks.audioStop).not.toHaveBeenCalled();
    expect(mocks.updateSession).not.toHaveBeenCalled();
    expect(useRecording.getState()).toMatchObject({status: "idle", starting: false, sessionId: "session-a"});
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("保留原录音"), "error");
  });

  it("prevents detach and reattachment throughout asynchronous start", async () => {
    const session = deferred<SessionRow>();
    mocks.getSession.mockReturnValue(session.promise);
    const start = useRecording.getState().start(3);
    expect(useRecording.getState().starting).toBe(true);
    useRecording.getState().detach();
    expect(useRecording.getState().attach("session-b", "pdf-b")).toBe(false);
    expect(useRecording.getState().sessionId).toBe("session-a");
    session.resolve(emptySession());
    await start;
    expect(mocks.audioStart).toHaveBeenCalledWith("C:/test-only/session-a.wav", false);
    expect(useRecording.getState()).toMatchObject({status: "recording", sessionId: "session-a", deckId: "pdf-a"});
  });

  it.each(["recording", "paused"] as const)("cannot detach or redirect a %s session", (status) => {
    useRecording.setState({status});
    useRecording.getState().detach();
    expect(useRecording.getState().attach("session-b", "pdf-b")).toBe(false);
    expect(useRecording.getState()).toMatchObject({sessionId: "session-a", deckId: "pdf-a", status});
  });

  it("stop cancels a pending session lookup and never starts the microphone afterwards", async () => {
    const session = deferred<SessionRow>();
    mocks.getSession.mockReturnValue(session.promise);
    const start = useRecording.getState().start(0);
    let stopped = false;
    const stop = useRecording.getState().stop().then(() => {stopped = true;});
    await settle();
    expect(stopped).toBe(false);
    session.resolve(emptySession());
    await Promise.all([start, stop]);
    expect(mocks.audioStart).not.toHaveBeenCalled();
    expect(mocks.nativeState).toBe("idle");
    expect(useRecording.getState()).toMatchObject({status: "idle", starting: false});
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("stop waits for an in-flight native start, closes it and preserves its WAV", async () => {
    const opened = deferred<void>();
    mocks.audioStart.mockImplementation(async () => {await opened.promise; mocks.nativeState = "recording";});
    const start = useRecording.getState().start(4);
    await settle();
    expect(mocks.audioStart).toHaveBeenCalledOnce();
    let stopped = false;
    const stop = useRecording.getState().stop().then(() => {stopped = true;});
    await settle();
    expect(stopped).toBe(false);
    opened.resolve();
    await Promise.all([start, stop]);
    expect(mocks.audioStop).toHaveBeenCalledOnce();
    expect(mocks.nativeState).toBe("idle");
    expect(mocks.updateSession).toHaveBeenCalledWith("session-a", expect.objectContaining({
      local_wav_path: "C:/test-only/session-a.wav", audio_status: "local", duration_ms: 1200,
      started_at: expect.any(String), ended_at: expect.any(String),
    }));
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("coalesces repeated stop requests instead of writing duplicate stop events", async () => {
    await useRecording.getState().start(0);
    const first = useRecording.getState().stop();
    const second = useRecording.getState().stop();
    expect(first).toBe(second);
    await first;
    expect(mocks.audioStop).toHaveBeenCalledOnce();
    expect(mocks.appendEvent.mock.calls.filter((call) => call[3]?.state === "stopped")).toHaveLength(1);
  });

  it("still closes the microphone when saving the retained note draft fails", async () => {
    await useRecording.getState().start(0);
    mocks.flush.mockRejectedValueOnce(new Error("SQLITE_FULL"));
    await useRecording.getState().stop();
    expect(mocks.audioStop).toHaveBeenCalledOnce();
    expect(mocks.nativeState).toBe("idle");
    expect(useRecording.getState().status).toBe("idle");
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("草稿已保留"), "error");
  });
});

describe("ASR ownership during stop and switching recordings", () => {
  beforeEach(() => {mocks.settings.asrEnabled = true;});

  it("invalidates slow model preparation before attaching another recording", async () => {
    const model = deferred<string>();
    mocks.readyDirFor.mockReturnValueOnce(model.promise);
    await useRecording.getState().start(1);
    await settle();
    await useRecording.getState().stop();
    expect(useRecording.getState().attach("session-b", "pdf-b")).toBe(true);
    model.resolve("C:/test-only/asr-model");
    await settle();
    expect(mocks.asrStart).not.toHaveBeenCalled();
    expect(mocks.finals.size).toBe(0);
    expect(useRecording.getState()).toMatchObject({sessionId: "session-b", asr: "off"});
  });

  it("retains the old final sentence, then removes old callbacks before accepting a new recording", async () => {
    await useRecording.getState().start(3);
    await settle();
    expect(mocks.finals.size).toBe(1);
    const oldFinal = [...mocks.finals][0];
    let stopped = false;
    const stop = useRecording.getState().stop().then(() => {stopped = true;});
    await settle();
    expect(mocks.asrStop).toHaveBeenCalledOnce();
    expect(useRecording.getState().attach("session-b", "pdf-b")).toBe(false);
    useRecording.getState().detach();
    oldFinal({t0_ms: 100, t1_ms: 1200, text: "  old final sentence  "});
    expect(mocks.insertDeviceSegment).toHaveBeenCalledWith("session-a", 100, 1200, "old final sentence", 3);
    await vi.advanceTimersByTimeAsync(799);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stop;
    expect(mocks.finals.size).toBe(0);
    expect(useRecording.getState().attach("session-b", "pdf-b")).toBe(true);
    await useRecording.getState().start(7);
    await settle();
    oldFinal({t0_ms: 0, t1_ms: 1, text: "stale queued callback"});
    for (const callback of mocks.finals) callback({t0_ms: 0, t1_ms: 800, text: "new final sentence"});
    expect(mocks.insertDeviceSegment.mock.calls).toEqual([
      ["session-a", 100, 1200, "old final sentence", 3],
      ["session-b", 0, 800, "new final sentence", 7],
    ]);
  });

  it("awaits an in-flight native ASR start before stopping the native engine", async () => {
    const started = deferred<void>();
    let nativeAsrStarted = false;
    mocks.asrStart.mockImplementation(async () => {await started.promise; nativeAsrStarted = true;});
    mocks.asrStop.mockImplementation(async () => {expect(nativeAsrStarted).toBe(true);});
    await useRecording.getState().start(0);
    await settle();
    expect(mocks.asrStart).toHaveBeenCalledOnce();
    const stop = useRecording.getState().stop();
    await settle();
    expect(mocks.asrStop).not.toHaveBeenCalled();
    started.resolve();
    await settle();
    expect(mocks.asrStop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(800);
    await stop;
    expect(useRecording.getState().status).toBe("idle");
  });

  it("also closes the native ASR slot after an engine error status", async () => {
    await useRecording.getState().start(0);
    await settle();
    for (const callback of mocks.statuses) callback({status: "error", message: "model failed"});
    expect(useRecording.getState().asr).toBe("error");
    const stop = useRecording.getState().stop();
    await settle();
    expect(mocks.asrStop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(800);
    await stop;
    expect(mocks.finals.size).toBe(0);
  });
});
