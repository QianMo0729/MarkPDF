import { invoke } from "@tauri-apps/api/core";

/** Thin wrappers over the Rust commands in src-tauri/src/commands.rs. */

export function fileSha256(path: string): Promise<string> {
  return invoke<string>("file_sha256", { path });
}

/** Copy any file the user picked into the app data dir. Returns bytes copied. */
export function copyFileIntoApp(src: string, dest: string): Promise<number> {
  return invoke<number>("copy_file", { src, dest });
}

export function fileSize(path: string): Promise<number> {
  return invoke<number>("file_size", { path });
}

/** Print through the shell "print" verb (the user's PDF reader); rejects when nothing handles it. */
export function printFile(path: string): Promise<void> {
  return invoke<void>("print_file", { path });
}
