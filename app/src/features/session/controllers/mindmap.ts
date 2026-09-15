import { create } from "zustand";
import { newId, nowIso } from "../../../core/utils/ids";
import { getAnnotation } from "../../../data/db/repos/annotations";
import { getDeck } from "../../../data/db/repos/decks";
import { deleteSubtree, ensureRoot, findByAnnotation, getNode, insertNode, nextOrderIndex, updateNode } from "../../../data/db/repos/mindmap";
import type { AnnotationRow, MindmapNodeRow } from "../../../data/db/schema";

interface MindmapStore {
  selectedId: string | null;
  editingId: string | null;
  /** Bumped when the panel should scroll a node into view. */
  reveal: { id: string; nonce: number } | null;
  select: (id: string | null) => void;
  edit: (id: string | null) => void;
  addChild: (deckId: string, parentId: string | null, markdown?: string) => Promise<string>;
  addSibling: (deckId: string, siblingId: string) => Promise<string>;
  addExcerpt: (deckId: string, annotation: AnnotationRow, parentId?: string | null) => Promise<string>;
  setMarkdown: (id: string, markdown: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reparent: (id: string, newParentId: string) => Promise<void>;
  toggleCollapsed: (id: string) => Promise<void>;
}

async function rootFor(deckId: string): Promise<MindmapNodeRow> {
  const deck = await getDeck(deckId);
  return ensureRoot(deckId, deck?.title ?? "导图");
}

function isDescendant(nodes: Map<string, MindmapNodeRow>, id: string, maybeAncestor: string): boolean {
  let cur = nodes.get(id)?.parent_id ?? null;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = nodes.get(cur)?.parent_id ?? null;
  }
  return false;
}

/** Mind map actions (docs/SPEC.md 6.5.19). Rows live in mindmap_nodes; the panel reads them via a live query. */
export const useMindmap = create<MindmapStore>((set, get) => ({
  selectedId: null,
  editingId: null,
  reveal: null,
  select: (id) => set({ selectedId: id, editingId: null }),
  edit: (id) => set({ editingId: id, selectedId: id ?? get().selectedId }),

  addChild: async (deckId, parentId, markdown = "") => {
    const parent = parentId ? await getNode(parentId) : await rootFor(deckId);
    const pid = parent?.id ?? (await rootFor(deckId)).id;
    const ts = nowIso();
    const row: MindmapNodeRow = {
      id: newId(),
      deck_id: deckId,
      parent_id: pid,
      kind: "text",
      markdown,
      annotation_id: null,
      page_index: null,
      order_index: await nextOrderIndex(pid),
      color: null,
      collapsed: 0,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
      dirty: 1,
    };
    await insertNode(row);
    if (parent?.collapsed) await updateNode(pid, { collapsed: 0 });
    set({ selectedId: row.id, editingId: row.id, reveal: { id: row.id, nonce: Date.now() } });
    return row.id;
  },

  addSibling: async (deckId, siblingId) => {
    const sib = await getNode(siblingId);
    if (!sib || !sib.parent_id) return get().addChild(deckId, siblingId);
    return get().addChild(deckId, sib.parent_id);
  },

  addExcerpt: async (deckId, annotation, parentId) => {
    const existing = await findByAnnotation(annotation.id);
    if (existing) {
      set({ selectedId: existing.id, reveal: { id: existing.id, nonce: Date.now() } });
      return existing.id;
    }
    const pid = parentId ?? get().selectedId ?? (await rootFor(deckId)).id;
    const parent = (await getNode(pid)) ?? (await rootFor(deckId));
    const ts = nowIso();
    const row: MindmapNodeRow = {
      id: newId(),
      deck_id: deckId,
      parent_id: parent.id,
      kind: "excerpt",
      markdown: "",
      annotation_id: annotation.id,
      page_index: annotation.page_index,
      order_index: await nextOrderIndex(parent.id),
      color: annotation.color,
      collapsed: 0,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
      dirty: 1,
    };
    await insertNode(row);
    if (parent.collapsed) await updateNode(parent.id, { collapsed: 0 });
    set({ selectedId: row.id, reveal: { id: row.id, nonce: Date.now() } });
    return row.id;
  },

  setMarkdown: async (id, markdown) => {
    await updateNode(id, { markdown });
  },

  remove: async (id) => {
    const node = await getNode(id);
    if (!node || node.kind === "root") return;
    await deleteSubtree(id);
    set((s) => ({ selectedId: s.selectedId === id ? node.parent_id : s.selectedId, editingId: null }));
  },

  reparent: async (id, newParentId) => {
    if (id === newParentId) return;
    const node = await getNode(id);
    const target = await getNode(newParentId);
    if (!node || !target || node.kind === "root") return;
    const all = new Map<string, MindmapNodeRow>();
    for (const n of [node, target]) all.set(n.id, n);
    // Walk up from the target to make sure we are not dropping a node into its own subtree.
    let cur: MindmapNodeRow | null = target;
    while (cur?.parent_id) {
      if (cur.parent_id === id) return;
      cur = await getNode(cur.parent_id);
      if (cur) all.set(cur.id, cur);
    }
    if (isDescendant(all, newParentId, id)) return;
    await updateNode(id, { parent_id: newParentId, order_index: await nextOrderIndex(newParentId) });
    if (target.collapsed) await updateNode(newParentId, { collapsed: 0 });
  },

  toggleCollapsed: async (id) => {
    const n = await getNode(id);
    if (n) await updateNode(id, { collapsed: n.collapsed ? 0 : 1 });
  },
}));

/** Excerpt text shown on a card: the highlighted passage or the text box content. */
export function excerptText(a: AnnotationRow | null | undefined): string {
  if (!a) return "";
  if (a.kind === "highlight") return (a.selected_text ?? "").trim();
  if (a.kind === "text_box") return (a.markdown ?? "").trim();
  return "墨迹";
}

export { getAnnotation };
