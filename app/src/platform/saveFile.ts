import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

/** Ask for a destination and write bytes there; falls back to the Rust command when the fs scope refuses. */
export async function saveBytesWithDialog(defaultName: string, bytes: Uint8Array, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) return null;
  await writeBytes(path, bytes);
  return path;
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(path, bytes);
  } catch {
    await invoke("write_bytes_b64", { path, dataB64: toBase64(bytes) });
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(s);
}
