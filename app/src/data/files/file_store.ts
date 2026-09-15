import { appCacheDir, appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";

/** Local file layout (docs/SPEC.md 4.6). All functions return absolute paths. */

let dataDirCache: string | null = null;
let cacheDirCache: string | null = null;

export async function dataDir(): Promise<string> {
  if (!dataDirCache) dataDirCache = await appDataDir();
  return dataDirCache;
}

export async function cacheDir(): Promise<string> {
  if (!cacheDirCache) cacheDirCache = await appCacheDir();
  return cacheDirCache;
}

async function ensureDir(path: string): Promise<void> {
  if (!(await exists(path))) await mkdir(path, { recursive: true });
}

export async function ensureDirs(): Promise<void> {
  const d = await dataDir();
  const c = await cacheDir();
  await ensureDir(await join(d, "decks"));
  await ensureDir(await join(d, "sessions"));
  await ensureDir(await join(d, "asr_models"));
  await ensureDir(await join(c, "thumbs"));
}

export async function deckPdfPath(deckId: string): Promise<string> {
  return join(await dataDir(), "decks", `${deckId}.pdf`);
}

export async function deckSourcePath(deckId: string, ext: string): Promise<string> {
  return join(await dataDir(), "decks", `${deckId}.${ext}`);
}

export async function sessionWavPath(sessionId: string): Promise<string> {
  return join(await dataDir(), "sessions", `${sessionId}.wav`);
}

export async function sessionM4aPath(sessionId: string): Promise<string> {
  return join(await dataDir(), "sessions", `${sessionId}.m4a`);
}

export async function asrModelDir(modelId: string): Promise<string> {
  return join(await dataDir(), "asr_models", modelId);
}

export async function thumbDir(deckId: string): Promise<string> {
  const dir = await join(await cacheDir(), "thumbs", deckId);
  await ensureDir(dir);
  return dir;
}

export async function thumbPath(deckId: string, pageIndex: number): Promise<string> {
  return join(await thumbDir(deckId), `${pageIndex}.png`);
}
