import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Wrappers over src-tauri/src/audio (docs/SPEC.md 7.1). */

export type AudioRunState = "idle" | "recording" | "paused";

export interface WavInfo {
  sample_rate: number;
  channels: number;
  samples: number;
  duration_ms: number;
}

export const audioStart = (wavPath: string, append = false) => invoke<void>("audio_start", { wavPath, append });
export const audioPause = () => invoke<void>("audio_pause");
export const audioResume = () => invoke<void>("audio_resume");
export const audioStop = () => invoke<{ duration_ms: number }>("audio_stop");
export const audioStatus = () => invoke<{ state: AudioRunState; t_ms: number }>("audio_status");
export const wavProbe = (path: string) => invoke<WavInfo>("wav_probe", { path });
/** Crash recovery: rewrite the RIFF/data sizes from the PCM actually on disk (docs/SPEC.md 6.5.18). */
export const wavRepair = (path: string) => invoke<WavInfo>("wav_repair", { path });
/** Dev/test only: play a WAV into the running recorder as a virtual mic (debug builds). */
export const audioInjectWav = (path: string) => invoke<number>("audio_inject_wav", { path });

export function onAudioTick(cb: (tMs: number) => void): Promise<UnlistenFn> {
  return listen<{ t_ms: number }>("audio://tick", (e) => cb(e.payload.t_ms));
}
export function onAudioLevel(cb: (db: number) => void): Promise<UnlistenFn> {
  return listen<{ db: number }>("audio://level", (e) => cb(e.payload.db));
}
export type AudioStateName = "recording" | "paused" | "stopped" | "interrupted" | "error";
/** `interrupted`: the device failed (paused until "继续录音"); `error`: the WAV writer died, `message` says why. */
export function onAudioState(cb: (state: AudioStateName, message?: string | null) => void): Promise<UnlistenFn> {
  return listen<{ state: AudioStateName; message?: string | null }>("audio://state", (e) => cb(e.payload.state, e.payload.message));
}
