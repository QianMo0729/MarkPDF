import { execute, insertRow, select, selectOne, updateById } from "../client";
import { notifyChanged } from "../live";
import type { SessionRow } from "../schema";
import { nowIso } from "../../../core/utils/ids";

export interface SessionListItem extends SessionRow {
  deck_title: string;
  course_name: string;
}

const LIST_SQL = `
  SELECT s.*, d.title AS deck_title, c.name AS course_name
  FROM sessions s
  JOIN decks d ON d.id = s.deck_id
  JOIN courses c ON c.id = s.course_id
  WHERE s.deleted_at IS NULL`;

export async function listSessions(courseId: string): Promise<SessionListItem[]> {
  return select<SessionListItem>(`${LIST_SQL} AND s.course_id = ? ORDER BY s.created_at DESC`, [courseId]);
}

export async function listRecentSessions(limit = 50): Promise<SessionListItem[]> {
  return select<SessionListItem>(`${LIST_SQL} ORDER BY s.created_at DESC LIMIT ?`, [limit]);
}

export async function getSession(id: string): Promise<SessionRow | null> {
  return selectOne<SessionRow>("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL", [id]);
}

export async function insertSession(row: SessionRow): Promise<void> {
  await insertRow("sessions", row as unknown as Record<string, unknown>);
  notifyChanged("sessions");
}

export async function updateSession(id: string, patch: Partial<SessionRow>): Promise<void> {
  await updateById("sessions", id, { ...patch, updated_at: nowIso(), dirty: 1 });
  notifyChanged("sessions");
}

/** Tombstone the row; its per-session data (events, transcript, summaries) is dropped for good. Files: see domain/deletion.ts. */
export async function deleteSession(id: string): Promise<void> {
  const ts = nowIso();
  await execute("UPDATE sessions SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?", [ts, ts, id]);
  await execute("DELETE FROM events WHERE session_id = ?", [id]);
  await execute("DELETE FROM transcript_segments WHERE session_id = ?", [id]);
  await execute("DELETE FROM page_summaries WHERE session_id = ?", [id]);
  await execute("DELETE FROM session_summaries WHERE session_id = ?", [id]);
  notifyChanged("sessions", "events", "transcript_segments", "page_summaries", "session_summaries");
}

/** Live rows of a deck (cascading deletes). */
export async function listSessionsForDeck(deckId: string): Promise<SessionRow[]> {
  return select<SessionRow>("SELECT * FROM sessions WHERE deck_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC", [deckId]);
}

/** Tombstoned rows whose media may still be on disk (startup sweep). */
export async function listDeletedSessionsWithFiles(): Promise<Pick<SessionRow, "id" | "local_wav_path">[]> {
  return select<Pick<SessionRow, "id" | "local_wav_path">>("SELECT id, local_wav_path FROM sessions WHERE deleted_at IS NOT NULL");
}

/** Sessions that were never ended (crash recovery, docs/SPEC.md 6.5.18). */
export async function listUnfinishedSessions(): Promise<SessionRow[]> {
  return select<SessionRow>(
    "SELECT * FROM sessions WHERE ended_at IS NULL AND started_at IS NOT NULL AND deleted_at IS NULL",
  );
}
