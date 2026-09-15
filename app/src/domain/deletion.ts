import { join } from "@tauri-apps/api/path";
import { exists, remove } from "@tauri-apps/plugin-fs";
import { deleteCourse } from "../data/db/repos/courses";
import { deleteDeck, listDeletedDeckIds, listDecks, listStaleImportingDecks, updateDeck } from "../data/db/repos/decks";
import { deleteSession, listDeletedSessionsWithFiles, listSessionsForDeck } from "../data/db/repos/sessions";
import { getState, setState } from "../data/db/repos/syncState";
import type { SessionRow } from "../data/db/schema";
import { cacheDir, deckPdfPath, deckSourcePath, sessionM4aPath, sessionWavPath } from "../data/files/file_store";
import { evictDocument } from "../pdf/documents";
import { forgetThumbnails } from "../pdf/thumbnails";

/**
 * Deleting a course / deck / session removes the media that belongs to it
 * (PDF, source file, thumbnails, WAV / M4A) as well as the rows, so disk space
 * really comes back (release audit B03 / PM-02). Rows keep their tombstone
 * (`deleted_at`) for a future sync; files that could not be removed are noted in
 * `sync_state.pending_file_deletes` and retried on the next start.
 */

const PENDING_KEY = "pending_file_deletes";

async function pendingList(): Promise<string[]> {
  try {
    const raw = await getState(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function rememberPending(path: string): Promise<void> {
  const list = await pendingList();
  if (!list.includes(path)) await setState(PENDING_KEY, JSON.stringify([...list, path]));
}

/** Remove a file or directory; a failure is recorded for a later retry instead of being lost. */
export async function safeRemove(path: string, recursive = false): Promise<boolean> {
  try {
    if (!(await exists(path))) return true;
    await remove(path, { recursive });
    return true;
  } catch (e) {
    console.warn("[deletion] could not remove", path, e);
    await rememberPending(path).catch(() => undefined);
    return false;
  }
}

/** Retry everything that failed earlier; keeps what still fails. */
export async function retryPendingDeletes(): Promise<void> {
  const list = await pendingList();
  if (!list.length) return;
  const still: string[] = [];
  for (const path of list) {
    try {
      if (await exists(path)) await remove(path, { recursive: true });
    } catch {
      still.push(path);
    }
  }
  await setState(PENDING_KEY, JSON.stringify(still));
}

async function purgeSessionFiles(sessionId: string, wavPath: string | null): Promise<void> {
  await safeRemove(wavPath ?? (await sessionWavPath(sessionId)));
  await safeRemove(await sessionM4aPath(sessionId));
}

async function purgeDeckFiles(deckId: string): Promise<void> {
  evictDocument(deckId);
  forgetThumbnails(deckId);
  await safeRemove(await deckPdfPath(deckId));
  await safeRemove(await deckSourcePath(deckId, "pptx"));
  await safeRemove(await join(await cacheDir(), "thumbs", deckId), true);
}

/** A class: rows (tombstone + hard-deleted children) and its recording. */
export async function deleteSessionWithFiles(session: Pick<SessionRow, "id" | "local_wav_path">): Promise<void> {
  await deleteSession(session.id);
  await purgeSessionFiles(session.id, session.local_wav_path);
}

/** A deck: every class on it, its notes / annotations / pages, the PDF and thumbnails. */
export async function deleteDeckWithFiles(deckId: string): Promise<void> {
  for (const s of await listSessionsForDeck(deckId)) await deleteSessionWithFiles(s);
  await deleteDeck(deckId);
  await purgeDeckFiles(deckId);
}

/** A course: every deck (and class) under it. */
export async function deleteCourseWithFiles(courseId: string): Promise<void> {
  for (const d of await listDecks(courseId)) await deleteDeckWithFiles(d.id);
  await deleteCourse(courseId);
}

/**
 * Startup sweep: media of rows that were deleted before file cleanup existed,
 * plus the retry ledger. Also marks decks stuck in `importing` (the app was
 * closed mid-import) as failed so the card offers "重试" (audit PM-06).
 */
export async function sweepAtStartup(): Promise<void> {
  try {
    for (const s of await listDeletedSessionsWithFiles()) await purgeSessionFiles(s.id, s.local_wav_path);
    for (const id of await listDeletedDeckIds()) await purgeDeckFiles(id);
    await retryPendingDeletes();
    for (const d of await listStaleImportingDecks()) await updateDeck(d.id, { status: "error", error_message: "导入被中断" });
  } catch (e) {
    console.warn("[deletion] startup sweep failed", e);
  }
}

/** Settings → 清理缩略图缓存: drop every cached PNG (they are re-rendered on demand). */
export async function clearThumbnailCache(): Promise<void> {
  forgetThumbnails();
  const dir = await join(await cacheDir(), "thumbs");
  await safeRemove(dir, true);
}
