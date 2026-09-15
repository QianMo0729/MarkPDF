import { create } from "zustand";
import { newId, nowIso } from "../../../core/utils/ids";
import {
  getAnnotation,
  insertAnnotation,
  nextZ,
  restoreAnnotation,
  softDeleteAnnotation,
  updateAnnotation,
} from "../../../data/db/repos/annotations";
import type { AnnotationRow } from "../../../data/db/schema";
import { bboxOfPoints, bboxOfQuads } from "../../../pdf/coords";
import type { Stroke } from "../../../pdf/layers/geometry";

/** Undoable operations (docs/SPEC.md 6.5.5 通用: 20 steps, per session screen). */
type Op =
  | { kind: "create"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "update"; id: string; before: Partial<AnnotationRow>; after: Partial<AnnotationRow> };

const UNDO_MAX = 20;

export type SnapshotOp = "created" | "updated" | "deleted";

/** Text box look at creation time (docs/SPEC.md 6.5.5); null = no border / no fill. */
export interface TextBoxStyle {
  color: string;
  fontSize: number;
  borderColor: string | null;
  fillColor: string | null;
}

interface AnnotationStore {
  selectedId: string | null;
  editingId: string | null;
  popoverId: string | null;
  flashId: string | null;
  undoStack: Op[];
  redoStack: Op[];
  /** Live mode hook (docs/SPEC.md 5.6); null outside recording. */
  onChangeForSnapshot: ((op: SnapshotOp, row: AnnotationRow) => void) | null;

  select: (id: string | null) => void;
  edit: (id: string | null) => void;
  openPopover: (id: string | null) => void;
  flash: (id: string) => void;
  reset: () => void;

  createHighlight: (deckId: string, page: number, quads: number[][], selectedText: string, color: string) => Promise<string>;
  createTextBox: (deckId: string, page: number, x: number, y: number, w: number, h: number, style: TextBoxStyle) => Promise<string>;
  createInk: (deckId: string, page: number, stroke: Stroke, color: string, width: number) => Promise<string>;
  update: (id: string, patch: Partial<AnnotationRow>, undoable?: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

function push(stack: Op[], op: Op): Op[] {
  const next = [...stack, op];
  return next.length > UNDO_MAX ? next.slice(next.length - UNDO_MAX) : next;
}

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  selectedId: null,
  editingId: null,
  popoverId: null,
  flashId: null,
  undoStack: [],
  redoStack: [],
  onChangeForSnapshot: null,

  select: (id) => set({ selectedId: id, popoverId: null, editingId: get().editingId === id ? get().editingId : null }),
  edit: (id) => set({ editingId: id, selectedId: id ?? get().selectedId, popoverId: null }),
  openPopover: (id) => set({ popoverId: id, selectedId: id ?? get().selectedId }),
  flash: (id) => {
    set({ flashId: id });
    window.setTimeout(() => get().flashId === id && set({ flashId: null }), 400);
  },
  reset: () => set({ selectedId: null, editingId: null, popoverId: null, undoStack: [], redoStack: [] }),

  createHighlight: async (deckId, page, quads, selectedText, color) => {
    const box = bboxOfQuads(quads);
    const row = await baseRow(deckId, page, "highlight", box);
    row.color = color;
    row.selected_text = selectedText;
    row.quads_json = JSON.stringify(quads.map((q) => q.map((v) => round(v))));
    await insertAnnotation(row);
    afterCreate(set, get, row);
    return row.id;
  },

  createTextBox: async (deckId, page, x, y, w, h, style) => {
    const row = await baseRow(deckId, page, "text_box", { x, y, w, h });
    row.color = style.color;
    row.markdown = "";
    row.font_size = style.fontSize;
    row.border_color = style.borderColor;
    row.fill_color = style.fillColor;
    await insertAnnotation(row);
    afterCreate(set, get, row);
    return row.id;
  },

  createInk: async (deckId, page, stroke, color, width) => {
    const box = bboxOfPoints(stroke, width / 2);
    const row = await baseRow(deckId, page, "ink", box);
    row.color = color;
    row.stroke_width = width;
    row.strokes_json = JSON.stringify([stroke.map(([x, y]) => [round(x), round(y)])]);
    await insertAnnotation(row);
    afterCreate(set, get, row);
    return row.id;
  },

  update: async (id, patch, undoable = true) => {
    const before = await getAnnotation(id);
    if (!before) return;
    const prev: Partial<AnnotationRow> = {};
    for (const k of Object.keys(patch) as (keyof AnnotationRow)[]) (prev as Record<string, unknown>)[k] = before[k];
    await updateAnnotation(id, patch);
    if (undoable) set((s) => ({ undoStack: push(s.undoStack, { kind: "update", id, before: prev, after: patch }), redoStack: [] }));
    const row = await getAnnotation(id);
    if (row) get().onChangeForSnapshot?.("updated", row);
  },

  remove: async (id) => {
    const row = await getAnnotation(id);
    await softDeleteAnnotation(id);
    set((s) => ({
      undoStack: push(s.undoStack, { kind: "delete", id }),
      redoStack: [],
      selectedId: s.selectedId === id ? null : s.selectedId,
      editingId: s.editingId === id ? null : s.editingId,
      popoverId: s.popoverId === id ? null : s.popoverId,
    }));
    if (row) get().onChangeForSnapshot?.("deleted", { ...row, deleted_at: nowIso() });
  },

  undo: async () => {
    const s = get();
    const op = s.undoStack[s.undoStack.length - 1];
    if (!op) return;
    set({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, op] });
    await applyInverse(op, get);
  },

  redo: async () => {
    const s = get();
    const op = s.redoStack[s.redoStack.length - 1];
    if (!op) return;
    set({ redoStack: s.redoStack.slice(0, -1), undoStack: push(s.undoStack, op) });
    await applyForward(op, get);
  },
}));

async function baseRow(deckId: string, page: number, kind: AnnotationRow["kind"], box: { x: number; y: number; w: number; h: number }): Promise<AnnotationRow> {
  const ts = nowIso();
  return {
    id: newId(),
    deck_id: deckId,
    page_index: page,
    kind,
    x: round(box.x),
    y: round(box.y),
    w: round(box.w),
    h: round(box.h),
    color: "#000000",
    markdown: null,
    selected_text: null,
    quads_json: null,
    strokes_json: null,
    stroke_width: null,
    font_size: null,
    border_color: null,
    fill_color: null,
    z: await nextZ(deckId, page),
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 1,
  };
}

function afterCreate(set: (p: Partial<AnnotationStore> | ((s: AnnotationStore) => Partial<AnnotationStore>)) => void, get: () => AnnotationStore, row: AnnotationRow) {
  set((s) => ({ undoStack: push(s.undoStack, { kind: "create", id: row.id }), redoStack: [] }));
  get().onChangeForSnapshot?.("created", row);
}

async function applyInverse(op: Op, get: () => AnnotationStore) {
  const hook = get().onChangeForSnapshot;
  if (op.kind === "create") {
    const row = await getAnnotation(op.id);
    await softDeleteAnnotation(op.id);
    if (row) hook?.("deleted", { ...row, deleted_at: nowIso() });
  } else if (op.kind === "delete") {
    await restoreAnnotation(op.id);
    const row = await getAnnotation(op.id);
    if (row) hook?.("created", row);
  } else {
    await updateAnnotation(op.id, op.before);
    const row = await getAnnotation(op.id);
    if (row) hook?.("updated", row);
  }
}

async function applyForward(op: Op, get: () => AnnotationStore) {
  const hook = get().onChangeForSnapshot;
  if (op.kind === "create") {
    await restoreAnnotation(op.id);
    const row = await getAnnotation(op.id);
    if (row) hook?.("created", row);
  } else if (op.kind === "delete") {
    const row = await getAnnotation(op.id);
    await softDeleteAnnotation(op.id);
    if (row) hook?.("deleted", { ...row, deleted_at: nowIso() });
  } else {
    await updateAnnotation(op.id, op.after);
    const row = await getAnnotation(op.id);
    if (row) hook?.("updated", row);
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Parsed helpers used by the layer and panels. */
export function parseQuads(row: AnnotationRow): number[][] {
  try {
    return row.quads_json ? (JSON.parse(row.quads_json) as number[][]) : [];
  } catch {
    return [];
  }
}

export function parseStrokes(row: AnnotationRow): Stroke[] {
  try {
    return row.strokes_json ? (JSON.parse(row.strokes_json) as Stroke[]) : [];
  } catch {
    return [];
  }
}
