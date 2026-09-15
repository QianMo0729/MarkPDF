import type { SessionRow } from "../../data/db/schema";

/** Ignore abandoned preparation rows, while retaining all existing recordings. */
export function recordingsForDeck(rows: SessionRow[], deckId: string): SessionRow[] {
  return rows.filter((s) => s.deck_id === deckId && !s.deleted_at && s.started_at !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function selectedRecordingId(
  deckId: string, requested: string | null, rows: SessionRow[],
  active: { deckId: string | null; sessionId: string | null; status: string; starting: boolean },
): string {
  if (active.deckId === deckId && (active.status !== "idle" || active.starting) && active.sessionId) return active.sessionId;
  if (requested === "none") return "";
  if (requested) return requested; // The DB read validates ownership; a new row may still be loading.
  return recordingsForDeck(rows, deckId)[0]?.id ?? "";
}
