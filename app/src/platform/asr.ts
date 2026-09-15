import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Wrappers over src-tauri/src/asr (docs/SPEC.md 7.5). */

export interface AsrFinal {
  t0_ms: number;
  t1_ms: number;
  text: string;
}

export interface AsrStatus {
  status: "loading" | "ready" | "lagging" | "error" | "stopped";
  message: string | null;
}

export interface AsrBenchResult {
  segments: AsrFinal[];
  audio_ms: number;
  load_ms: number;
  decode_ms: number;
}

/** Attach the on-device recognizer to the running recorder. */
export const asrStart = (modelDir: string) => invoke<void>("asr_start", { modelDir });
export const asrStop = () => invoke<void>("asr_stop");
/** Dev/test: decode a 16 kHz WAV offline with the same engine. */
export const asrBench = (modelDir: string, wavPath: string) => invoke<AsrBenchResult>("asr_bench", { modelDir, wavPath });

export function onAsrPartial(cb: (text: string) => void): Promise<UnlistenFn> {
  return listen<{ text: string }>("asr://partial", (e) => cb(e.payload.text));
}
export function onAsrFinal(cb: (seg: AsrFinal) => void): Promise<UnlistenFn> {
  return listen<AsrFinal>("asr://final", (e) => cb(e.payload));
}
export function onAsrStatus(cb: (s: AsrStatus) => void): Promise<UnlistenFn> {
  return listen<AsrStatus>("asr://status", (e) => cb(e.payload));
}
