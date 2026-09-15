import { convertFileSrc } from "@tauri-apps/api/core";
import { exists } from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import { S } from "../../../core/strings";
import type { Timeline } from "../../../domain/timeline";

export type NoteViewMode = "atTime" | "current";

interface PlaybackStore {
  sessionId: string | null;
  wavPath: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  speed: number;
  followPages: boolean;
  noteViewMode: NoteViewMode;
  /** Set by the session screen so panels can read the timeline without prop drilling. */
  timeline: Timeline | null;
  ready: boolean;
  /** Why the recording cannot be played, in words the user can act on (audit PM-05). */
  error: string | null;

  load: (sessionId: string, wavPath: string, durationMs: number, speed: number) => Promise<void>;
  /** Re-open the file after an error (moved back, external drive reconnected…). */
  retry: () => Promise<void>;
  unload: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (ms: number) => void;
  skip: (deltaMs: number) => void;
  setSpeed: (s: number) => void;
  setFollowPages: (v: boolean) => void;
  setNoteViewMode: (m: NoteViewMode) => void;
  setTimeline: (t: Timeline | null) => void;
}

let audio: HTMLAudioElement | null = null;
let raf: number | null = null;
let lastEmit = 0;

function el(): HTMLAudioElement {
  if (!audio) {
    audio = document.createElement("audio");
    audio.preload = "auto";
  }
  return audio;
}

/** Wraps one hidden <audio> element (docs/SPEC.md 7.8). Position is sampled at ~30 Hz via rAF. */
export const usePlayback = create<PlaybackStore>((set, get) => {
  let loadGeneration = 0;
  const tick = () => {
    const a = el();
    const now = performance.now();
    if (now - lastEmit >= 33) {
      set({ positionMs: Math.floor(a.currentTime * 1000) });
      lastEmit = now;
    }
    if (!a.paused && !a.ended) raf = requestAnimationFrame(tick);
    else raf = null;
  };
  const startLoop = () => {
    if (raf === null) raf = requestAnimationFrame(tick);
  };

  const openFile = async (sessionId: string, wavPath: string, durationMs: number, speed: number) => {
    const generation = ++loadGeneration;
    const isCurrent = () => generation === loadGeneration;
    const a = el();
    a.pause();
    a.removeAttribute("src");
    a.load();
    set({ sessionId, wavPath, playing: false, positionMs: 0, durationMs, speed, ready: false, error: null });
    const available = await exists(wavPath).catch(() => true);
    // Switching PDFs/recordings or unloading may finish before this filesystem
    // check. An older request must never replace the newly selected recording.
    if (!isCurrent()) return;
    if (!available) {
      set({ error: S.errors.wavMissing(wavPath) });
      return;
    }
    a.src = convertFileSrc(wavPath);
    a.playbackRate = speed;
    a.onplay = () => {
      if (!isCurrent()) return;
      set({ playing: true });
      startLoop();
    };
    a.onpause = () => { if (isCurrent()) set({ playing: false, positionMs: Math.floor(a.currentTime * 1000) }); };
    a.onended = () => { if (isCurrent()) set({ playing: false, positionMs: durationMs }); };
    a.onerror = () => { if (isCurrent()) set({ error: S.errors.wavUnplayable(wavPath), ready: false }); };
    a.oncanplay = () => { if (isCurrent()) set({ ready: true, error: null }); };
    a.load();
    set({ sessionId, wavPath, playing: false, positionMs: 0, durationMs, speed, ready: false, error: null });
  };

  return {
    sessionId: null,
    wavPath: null,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    speed: 1,
    followPages: true,
    noteViewMode: "current",
    timeline: null,
    ready: false,
    error: null,

    load: async (sessionId, wavPath, durationMs, speed) => {
      if (get().sessionId === sessionId && el().src) return;
      set({ followPages: true, noteViewMode: "current" });
      await openFile(sessionId, wavPath, durationMs, speed);
    },
    retry: async () => {
      const { sessionId, wavPath, durationMs, speed } = get();
      if (sessionId && wavPath) await openFile(sessionId, wavPath, durationMs, speed);
    },
    unload: () => {
      loadGeneration += 1;
      const a = el();
      a.pause();
      a.onplay = a.onpause = a.onended = a.onerror = a.oncanplay = null;
      a.removeAttribute("src");
      a.load();
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      set({ sessionId: null, wavPath: null, playing: false, positionMs: 0, durationMs: 0, ready: false, error: null, timeline: null });
    },
    play: () => {
      const generation = loadGeneration;
      void el().play().catch((e) => {
        if (generation === loadGeneration) set({ error: S.errors.wavUnplayable(String(e)) });
      });
    },
    pause: () => el().pause(),
    toggle: () => (get().playing ? get().pause() : get().play()),
    seek: (ms) => {
      const a = el();
      const clamped = Math.max(0, Math.min(get().durationMs, ms));
      a.currentTime = clamped / 1000;
      set({ positionMs: clamped });
    },
    skip: (delta) => get().seek(get().positionMs + delta),
    setSpeed: (s) => {
      el().playbackRate = s;
      set({ speed: s });
    },
    setFollowPages: (v) => set({ followPages: v }),
    setNoteViewMode: (m) => set({ noteViewMode: m }),
    setTimeline: (t) => set({ timeline: t }),
  };
});
