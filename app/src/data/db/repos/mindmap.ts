import { execute, insertRow, select, selectOne, updateById } from "../client";
import { notifyChanged } from "../live";
import type { MindmapNodeRow } from "../schema";
import { newId, nowIso } from "../../../core/utils/ids";

export async function listNodes(deckId: string): Promise<MindmapNodeRow[]> {
  return select<MindmapNodeRow>("SELECT * FROM mindmap_nodes WHERE deck_id = ? AND deleted_at IS NULL ORDER BY order_index, created_at", [deckId]);
}

export async function getNode(id: string): Promise<MindmapNodeRow | null> {
  return selectOne<MindmapNodeRow>("SELECT * FROM mindmap_nodes WHERE id = ? AND deleted_at IS NULL", [id]);
}

/** The single root card for a deck, created on first use. */
export async function ensureRoot(deckId: string, title: string): Promise<MindmapNodeRow> {
  const existing = await selectOne<MindmapNodeRow>("SELECT * FROM mindmap_nodes WHERE deck_id = ? AND kind = 'root' AND deleted_at IS NULL", [deckId]);
  if (existing) return existing;
  const ts = nowIso();
  const row: MindmapNodeRow = {
    id: newId(),
    deck_id: deckId,
    parent_id: null,
    kind: "root",
    markdown: title,
    annotation_id: null,
    page_index: null,
    order_index: 0,
    color: null,
    collapsed: 0,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 1,
  };
  await insertRow("mindmap_nodes", row as unknown as Record<string, unknown>);
  notifyChanged("mindmap_nodes");
  return row;
}

export async function nextOrderIndex(parentId: string): Promise<number> {
  const r = await selectOne<{ m: number | null }>("SELECT MAX(order_index) AS m FROM mindmap_nodes WHERE parent_id = ? AND deleted_at IS NULL", [parentId]);
  return (r?.m ?? 0) + 1;
}

export async function insertNode(row: MindmapNodeRow): Promise<void> {
  await insertRow("mindmap_nodes", row as unknown as Record<string, unknown>);
  notifyChanged("mindmap_nodes");
}

export async function updateNode(id: string, patch: Partial<MindmapNodeRow>): Promise<void> {
  await updateById("mindmap_nodes", id, { ...patch, updated_at: nowIso(), dirty: 1 });
  notifyChanged("mindmap_nodes");
}

/** Soft-delete a node and every descendant. */
export async function deleteSubtree(id: string): Promise<void> {
  const ts = nowIso();
  const all = await select<MindmapNodeRow>("SELECT id, parent_id FROM mindmap_nodes WHERE deleted_at IS NULL");
  const children = new Map<string, string[]>();
  for (const n of all) if (n.parent_id) children.set(n.parent_id, [...(children.get(n.parent_id) ?? []), n.id]);
  const ids: string[] = [];
  const walk = (x: string) => {
    ids.push(x);
    for (const c of children.get(x) ?? []) walk(c);
  };
  walk(id);
  for (const x of ids) await execute("UPDATE mindmap_nodes SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?", [ts, ts, x]);
  notifyChanged("mindmap_nodes");
}

/** Node already linked to an annotation (so an excerpt is never added twice). */
export async function findByAnnotation(annotationId: string): Promise<MindmapNodeRow | null> {
  return selectOne<MindmapNodeRow>("SELECT * FROM mindmap_nodes WHERE annotation_id = ? AND deleted_at IS NULL", [annotationId]);
}
