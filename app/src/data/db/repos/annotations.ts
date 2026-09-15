import { execute, insertRow, select, selectOne, updateById } from "../client";
import { notifyChanged } from "../live";
import type { AnnotationRow } from "../schema";
import { nowIso } from "../../../core/utils/ids";

export async function listAnnotations(deckId: string, pageIndex?: number): Promise<AnnotationRow[]> {
  if (pageIndex === undefined) {
    return select<AnnotationRow>(
      "SELECT * FROM annotations WHERE deck_id = ? AND deleted_at IS NULL ORDER BY page_index, z, created_at",
      [deckId],
    );
  }
  return select<AnnotationRow>(
    "SELECT * FROM annotations WHERE deck_id = ? AND page_index = ? AND deleted_at IS NULL ORDER BY z, created_at",
    [deckId, pageIndex],
  );
}

export async function getAnnotation(id: string): Promise<AnnotationRow | null> {
  return selectOne<AnnotationRow>("SELECT * FROM annotations WHERE id = ?", [id]);
}

export async function pagesWithAnnotations(deckId: string): Promise<number[]> {
  const rows = await select<{ page_index: number }>(
    "SELECT DISTINCT page_index FROM annotations WHERE deck_id = ? AND deleted_at IS NULL",
    [deckId],
  );
  return rows.map((r) => r.page_index);
}

export async function nextZ(deckId: string, pageIndex: number): Promise<number> {
  const row = await selectOne<{ m: number | null }>(
    "SELECT MAX(z) AS m FROM annotations WHERE deck_id = ? AND page_index = ?",
    [deckId, pageIndex],
  );
  return (row?.m ?? 0) + 1;
}

export async function insertAnnotation(row: AnnotationRow): Promise<void> {
  await insertRow("annotations", row as unknown as Record<string, unknown>);
  notifyChanged("annotations");
}

export async function updateAnnotation(id: string, patch: Partial<AnnotationRow>): Promise<void> {
  await updateById("annotations", id, { ...patch, updated_at: nowIso(), dirty: 1 });
  notifyChanged("annotations");
}

export async function softDeleteAnnotation(id: string): Promise<void> {
  const ts = nowIso();
  await execute("UPDATE annotations SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?", [ts, ts, id]);
  notifyChanged("annotations");
}

/** Used by undo: bring a soft-deleted annotation back. */
export async function restoreAnnotation(id: string): Promise<void> {
  await execute("UPDATE annotations SET deleted_at = NULL, updated_at = ?, dirty = 1 WHERE id = ?", [nowIso(), id]);
  notifyChanged("annotations");
}
