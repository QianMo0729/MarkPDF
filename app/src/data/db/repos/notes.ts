import { insertRow, select, selectOne } from "../client";
import { notifyChanged } from "../live";
import type { NoteRow } from "../schema";
import { newId, nowIso } from "../../../core/utils/ids";

export async function getNote(deckId: string, pageIndex: number): Promise<NoteRow | null> {
  return selectOne<NoteRow>("SELECT * FROM notes WHERE deck_id = ? AND page_index = ?", [deckId, pageIndex]);
}

export async function listNotesForDeck(deckId: string): Promise<NoteRow[]> {
  return select<NoteRow>("SELECT * FROM notes WHERE deck_id = ? ORDER BY page_index", [deckId]);
}

/** Pages of a deck that have a non-empty note (thumbnail dots). */
export async function pagesWithNotes(deckId: string): Promise<number[]> {
  const rows = await select<{ page_index: number }>(
    "SELECT page_index FROM notes WHERE deck_id = ? AND length(trim(markdown)) > 0",
    [deckId],
  );
  return rows.map((r) => r.page_index);
}

export async function upsertNote(deckId: string, pageIndex: number, markdown: string): Promise<NoteRow> {
  const ts = nowIso();
  const row: NoteRow = {
    id: newId(),
    deck_id: deckId,
    page_index: pageIndex,
    markdown,
    created_at: ts,
    updated_at: ts,
    dirty: 1,
  };
  await insertRow("notes", row as unknown as Record<string, unknown>, {
    target: ["deck_id", "page_index"],
    update: ["markdown", "updated_at", "dirty"],
  });
  notifyChanged("notes");
  return (await getNote(deckId, pageIndex)) ?? row;
}
