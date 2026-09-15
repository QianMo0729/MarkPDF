import { execute, getDb, insertRow, select, selectOne, updateById } from "../client";
import { notifyChanged } from "../live";
import type { DeckPageRow, DeckRow } from "../schema";
import { nowIso } from "../../../core/utils/ids";

export async function listDecks(courseId: string): Promise<DeckRow[]> {
  return select<DeckRow>(
    "SELECT * FROM decks WHERE course_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
    [courseId],
  );
}

export async function getDeck(id: string): Promise<DeckRow | null> {
  return selectOne<DeckRow>("SELECT * FROM decks WHERE id = ? AND deleted_at IS NULL", [id]);
}

export async function findDeckBySha(courseId: string, sha256: string): Promise<DeckRow | null> {
  return selectOne<DeckRow>(
    "SELECT * FROM decks WHERE course_id = ? AND file_sha256 = ? AND deleted_at IS NULL",
    [courseId, sha256],
  );
}

/** Any ready deck with this content hash, whichever course it lives in ("open with" flow). */
export async function findDeckAnywhereBySha(sha256: string): Promise<DeckRow | null> {
  return selectOne<DeckRow>(
    "SELECT * FROM decks WHERE file_sha256 = ? AND deleted_at IS NULL AND status = 'ready' ORDER BY updated_at DESC LIMIT 1",
    [sha256],
  );
}

export async function insertDeck(row: DeckRow): Promise<void> {
  await insertRow("decks", row as unknown as Record<string, unknown>);
  notifyChanged("decks");
}

export async function updateDeck(id: string, patch: Partial<DeckRow>): Promise<void> {
  await updateById("decks", id, { ...patch, updated_at: nowIso(), dirty: 1 });
  notifyChanged("decks");
}

/** A single statement moves the PDF and, via migration 4, all its recordings. */
export async function moveDeckToCourse(id: string, courseId: string): Promise<void> {
  const result = await getDb().execute(
    `UPDATE decks SET course_id = ?, updated_at = ?, dirty = 1
     WHERE id = ? AND deleted_at IS NULL
       AND status NOT IN ('importing', 'uploading', 'converting')
       AND EXISTS (SELECT 1 FROM courses WHERE id = ? AND deleted_at IS NULL)`,
    [courseId, nowIso(), id, courseId],
  );
  if (result.rowsAffected !== 1) throw new Error("无法移动：请确认目标课程仍存在，并等待课件导入完成。");
  notifyChanged("decks", "sessions", "courses");
}

export interface RecentDeck extends DeckRow {
  course_name: string;
  recording_count: number;
}

export async function listRecentDecks(limit = 50): Promise<RecentDeck[]> {
  return select<RecentDeck>(
    `SELECT d.*, c.name AS course_name,
       (SELECT COUNT(*) FROM sessions s WHERE s.deck_id = d.id
         AND s.deleted_at IS NULL AND s.started_at IS NOT NULL) AS recording_count
     FROM decks d JOIN courses c ON c.id = d.course_id
     WHERE d.deleted_at IS NULL AND c.deleted_at IS NULL
     ORDER BY MAX(d.updated_at, COALESCE((SELECT MAX(s.updated_at) FROM sessions s
       WHERE s.deck_id = d.id AND s.deleted_at IS NULL), d.updated_at)) DESC LIMIT ?`,
    [limit],
  );
}

/** Tombstone the deck and its sessions / annotations; pages, notes and mind map rows are dropped. Files: see domain/deletion.ts. */
export async function deleteDeck(id: string): Promise<void> {
  const ts = nowIso();
  await execute("UPDATE decks SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?", [ts, ts, id]);
  await execute(
    "UPDATE sessions SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE deck_id = ? AND deleted_at IS NULL",
    [ts, ts, id],
  );
  await execute("UPDATE annotations SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE deck_id = ? AND deleted_at IS NULL", [ts, ts, id]);
  await execute("DELETE FROM deck_pages WHERE deck_id = ?", [id]);
  await execute("DELETE FROM notes WHERE deck_id = ?", [id]);
  await execute("DELETE FROM mindmap_nodes WHERE deck_id = ?", [id]);
  notifyChanged("decks", "sessions", "annotations", "deck_pages", "notes", "mindmap_nodes");
}

export async function listDeletedDeckIds(): Promise<string[]> {
  return (await select<{ id: string }>("SELECT id FROM decks WHERE deleted_at IS NOT NULL")).map((r) => r.id);
}

/** Decks left in `importing` by a previous run: no import can still be running at startup. */
export async function listStaleImportingDecks(): Promise<DeckRow[]> {
  return select<DeckRow>("SELECT * FROM decks WHERE status = 'importing' AND deleted_at IS NULL");
}

export async function upsertDeckPages(rows: DeckPageRow[]): Promise<void> {
  for (const r of rows) {
    await insertRow("deck_pages", r as unknown as Record<string, unknown>, {
      target: ["deck_id", "page_index"],
      update: ["width_pt", "height_pt", "text", "speaker_notes", "updated_at"],
    });
  }
  notifyChanged("deck_pages");
}

export async function getDeckPages(deckId: string): Promise<DeckPageRow[]> {
  return select<DeckPageRow>("SELECT * FROM deck_pages WHERE deck_id = ? ORDER BY page_index", [deckId]);
}

export async function getDeckPage(deckId: string, pageIndex: number): Promise<DeckPageRow | null> {
  return selectOne<DeckPageRow>("SELECT * FROM deck_pages WHERE deck_id = ? AND page_index = ?", [
    deckId,
    pageIndex,
  ]);
}
