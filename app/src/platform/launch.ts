import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** PDFs handed to the app by the OS ("Open with MarkPDF"); see src-tauri/src/launch.rs. */

/** Drain the files the process was started with. Call once, after the DB is ready. */
export function takeLaunchFiles(): Promise<string[]> {
  return invoke<string[]>("take_launch_files");
}

/** Files opened while the app is already running (forwarded by the second instance). */
export function onOpenFiles(cb: (paths: string[]) => void): Promise<UnlistenFn> {
  return listen<string[]>("open-files", (e) => cb(e.payload));
}
