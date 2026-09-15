import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ModelDownloadFile {
  url: string;
  name: string;
  sha256?: string;
  size_bytes?: number;
}

export interface ModelProgress {
  id: string;
  status: "downloading" | "ready" | "error" | "cancelled";
  progress: number;
  message: string | null;
}

export const modelsDownload = (id: string, dir: string, files: ModelDownloadFile[]) => invoke<void>("models_download", { id, dir, files });
export interface ExpectedFile {
  name: string;
  size_bytes?: number;
  sha256?: string;
}

export const modelsDelete = (dir: string) => invoke<void>("models_delete", { dir });
/** Cheap: regular, non-empty files of the expected size. */
export const modelsCheck = (dir: string, files: ExpectedFile[]) => invoke<boolean>("models_check", { dir, files });
/** Full SHA-256 check (slow; runs off the UI thread). */
export const modelsVerify = (dir: string, files: ExpectedFile[]) => invoke<boolean>("models_verify", { dir, files });
export const modelsCancel = (id: string) => invoke<boolean>("models_cancel", { id });
export const modelsActive = () => invoke<string[]>("models_active");

export function onModelProgress(cb: (p: ModelProgress) => void): Promise<UnlistenFn> {
  return listen<ModelProgress>("models://progress", (e) => cb(e.payload));
}
