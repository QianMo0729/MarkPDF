import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
  pending: [] as { path: string; resolve: (available: boolean) => void }[],
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (path: string) => new Promise<boolean>(resolve => files.pending.push({ path, resolve })),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://localhost/${path}` }));

import { usePlayback } from "../src/features/session/controllers/playback";

let audio: HTMLAudioElement;
const complete = (path: string, available = true) => {
  const index = files.pending.findIndex(p => p.path === path);
  expect(index).toBeGreaterThanOrEqual(0);
  files.pending.splice(index, 1)[0].resolve(available);
};

describe("recording playback selection", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLAudioElement) { audio = this; });
    usePlayback.getState().unload();
    files.pending = [];
  });

  afterEach(() => {
    usePlayback.getState().unload();
    vi.restoreAllMocks();
  });

  it.each([true, false])("a late old filesystem response (%s) cannot replace the newly selected recording", async oldAvailable => {
    const first = usePlayback.getState().load("first", "first.wav", 1000, 1);
    const second = usePlayback.getState().load("second", "second.wav", 2000, 1.5);
    expect(usePlayback.getState().sessionId).toBe("second");
    complete("second.wav");
    await second;
    audio.dispatchEvent(new Event("canplay"));
    complete("first.wav", oldAvailable);
    await first;
    expect(usePlayback.getState()).toMatchObject({ sessionId: "second", wavPath: "second.wav", durationMs: 2000, speed: 1.5, ready: true, error: null });
    expect(audio.src).toBe("asset://localhost/second.wav");
  });

  it("unloading cancels a pending load instead of resurrecting the previous recording", async () => {
    const pending = usePlayback.getState().load("first", "first.wav", 1000, 1);
    usePlayback.getState().unload();
    complete("first.wav");
    await pending;
    expect(usePlayback.getState()).toMatchObject({ sessionId: null, wavPath: null, ready: false, durationMs: 0 });
    expect(audio.getAttribute("src")).toBeNull();
  });

  it("opening a PDF's recording shows current notes by default and still permits historical notes", async () => {
    usePlayback.setState({ noteViewMode: "atTime" });
    const loading = usePlayback.getState().load("first", "first.wav", 1000, 1);
    expect(usePlayback.getState().noteViewMode).toBe("current");
    complete("first.wav");
    await loading;
    usePlayback.getState().setNoteViewMode("atTime");
    expect(usePlayback.getState().noteViewMode).toBe("atTime");
  });

  it("late audio callbacks from an earlier selection cannot change the new recording", async () => {
    const first = usePlayback.getState().load("first", "first.wav", 1000, 1);
    complete("first.wav");
    await first;
    const oldReady = audio.oncanplay;
    const oldEnded = audio.onended;
    const second = usePlayback.getState().load("second", "second.wav", 2000, 1);
    oldReady?.call(audio, new Event("canplay"));
    oldEnded?.call(audio, new Event("ended"));
    expect(usePlayback.getState()).toMatchObject({ sessionId: "second", positionMs: 0, ready: false });
    complete("second.wav");
    await second;
    expect(audio.src).toBe("asset://localhost/second.wav");
  });

  it("a retry is superseded by selecting another recording", async () => {
    const first = usePlayback.getState().load("first", "first.wav", 1000, 1);
    complete("first.wav", false);
    await first;
    expect(usePlayback.getState().error).toContain("first.wav");
    const retry = usePlayback.getState().retry();
    const second = usePlayback.getState().load("second", "second.wav", 2000, 1);
    complete("second.wav");
    await second;
    complete("first.wav");
    await retry;
    expect(usePlayback.getState()).toMatchObject({ sessionId: "second", error: null });
    expect(audio.src).toBe("asset://localhost/second.wav");
  });

  it("an old play request rejected during a switch cannot report an error on the new recording", async () => {
    const first = usePlayback.getState().load("first", "first.wav", 1000, 1);
    complete("first.wav");
    await first;
    let rejectPlay!: (error: Error) => void;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectPlay = reject; }));
    usePlayback.getState().play();
    const second = usePlayback.getState().load("second", "second.wav", 2000, 1);
    complete("second.wav");
    await second;
    rejectPlay(new Error("The first source was removed"));
    await Promise.resolve();
    expect(usePlayback.getState()).toMatchObject({ sessionId: "second", error: null });
  });
});
