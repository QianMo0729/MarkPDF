import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotationRow } from "../../data/db/schema";
import { MarkdownEditor, type MarkdownEditorHandle } from "../../editor/MarkdownEditor";
import { MarkdownView } from "../../editor/MarkdownView";
import { rectToCss, toPage, type CssRect, type PageGeom } from "../coords";
import { cssRectStyle } from "./PageLayer";

interface Props {
  row: AnnotationRow;
  geom: PageGeom;
  selected: boolean;
  editing: boolean;
  flash: boolean;
  readOnly: boolean;
  /** Select tool: drag the body to move, double-click to edit. */
  interactive: boolean;
  /** Text tool: a click (without dragging) on an existing box edits it instead of creating a new one. */
  editOnClick?: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onEndEdit: () => void;
  onCommit: (patch: Partial<AnnotationRow>, undoable?: boolean) => void;
  onOpenPage?: (page0: number) => void;
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];
/** Invisible strips along the frame: while editing they are the only way to drag the box (Word-style). */
const EDGES = ["n", "e", "s", "w"] as const;
const MIN_W = 60;
const MIN_H = 24;
/** Pointer travel (CSS px) before a press counts as a drag rather than a click. */
const DRAG_SLOP = 4;

/** Markdown text box anchored on the page: render state + edit state (docs/SPEC.md 6.5.5). */
export function TextBoxAnnotation({ row, geom, selected, editing, flash, readOnly, interactive, editOnClick, onSelect, onEdit, onEndEdit, onCommit, onOpenPage }: Props) {
  const base = rectToCss(geom, row.x, row.y, row.w, row.h);
  const [live, setLive] = useState<CssRect | null>(null);
  const [contentH, setContentH] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const draftRef = useRef(row.markdown ?? "");
  const saveTimer = useRef<number | null>(null);
  const rect = live ?? base;
  const fontPx = (row.font_size ?? 20) * geom.scale;
  /** Select or text tool, not read-only: the box can be moved and resized. */
  const manipulable = (interactive || !!editOnClick) && !readOnly;

  // Auto-grow to fit the content (never clip); a manual resize sets h as the minimum.
  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const cm = body.querySelector<HTMLElement>(".cm-content");
    const view = body.querySelector<HTMLElement>(".md-view, .mp-tb-empty");
    if (cm) {
      // Natural height of the document, independent of how the editor is stretched by layout.
      const ev = EditorView.findFromDOM(cm);
      const scroller = body.querySelector<HTMLElement>(".cm-scroller");
      const pad = scroller ? parseFloat(getComputedStyle(scroller).paddingTop) + parseFloat(getComputedStyle(scroller).paddingBottom) : 0;
      const natural = ev ? ev.lineBlockAt(ev.state.doc.length).bottom : cm.scrollHeight;
      setContentH(natural + pad + 4);
    } else if (view) setContentH(view.scrollHeight);
  }, []);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    // CodeMirror mounts a tick later than React; observe its content once it exists.
    const t = window.setTimeout(() => {
      const cm = body.querySelector(".cm-content");
      if (cm) ro.observe(cm);
      const view = body.querySelector(".md-view, .mp-tb-empty");
      if (view) ro.observe(view);
      measure();
    }, 50);
    measure();
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [editing, row.markdown, measure]);

  useEffect(() => {
    draftRef.current = row.markdown ?? "";
  }, [row.markdown, row.id]);

  const commitDraft = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if ((row.markdown ?? "") !== draftRef.current) onCommit({ markdown: draftRef.current }, false);
  };

  const onChange = (md: string) => {
    draftRef.current = md;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(commitDraft, 800);
    window.requestAnimationFrame(measure);
  };

  // ----- move: body when rendered, edge strips while editing; a press without travel is a click -----
  const startMove = (e: React.PointerEvent, onClick?: () => void) => {
    if (!manipulable || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault(); // keeps the editor focused when dragging an edge while editing
    if (!editing) onSelect();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = base;
    let current = base;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      moved = true;
      current = { ...start, left: start.left + dx, top: start.top + dy };
      setLive(current);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLive(null);
      if (moved) {
        const p = cssBoxToPage(geom, current);
        onCommit({ x: clamp(p.x, 0, geom.widthPt - row.w), y: clamp(p.y, 0, geom.heightPt - row.h) });
      } else onClick?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onBodyPointerDown = (e: React.PointerEvent) => {
    if (editing) return; // the editor owns the pointer; the edge strips move the box
    // Text tool: a plain click on an existing box edits it (the layer never sees the event, so no new box).
    startMove(e, editOnClick && !interactive ? onEdit : undefined);
  };

  // ----- resize -----
  const startResize = (h: Handle) => (e: React.PointerEvent) => {
    if (!manipulable || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = base;
    let current = base;
    const minW = MIN_W * geom.scale;
    const minH = MIN_H * geom.scale;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let { left, top, width, height } = start;
      if (h.includes("e")) width = Math.max(minW, start.width + dx);
      if (h.includes("s")) height = Math.max(minH, start.height + dy);
      if (h.includes("w")) {
        width = Math.max(minW, start.width - dx);
        left = start.left + start.width - width;
      }
      if (h.includes("n")) {
        height = Math.max(minH, start.height - dy);
        top = start.top + start.height - height;
      }
      current = { left, top, width, height };
      setLive(current);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setLive(null);
      if (current !== start) {
        const p = cssBoxToPage(geom, current);
        onCommit({ x: p.x, y: p.y, w: p.w, h: p.h });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const height = live ? rect.height : Math.max(rect.height, contentH + 4);
  const cls = ["mp-tb", selected ? "selected" : "", editing ? "editing" : "", flash ? "flash" : ""].filter(Boolean).join(" ");
  const framed = (selected || editing) && manipulable;

  return (
    <div
      className={cls}
      style={{
        ...cssRectStyle({ ...rect, height }),
        color: row.color,
        fontSize: fontPx,
        background: row.fill_color ?? "transparent",
        borderColor: row.border_color ?? "transparent",
        pointerEvents: interactive || editOnClick ? "auto" : "none",
      }}
      onPointerDown={(e) => {
        if (editing || editOnClick) e.stopPropagation();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!editing && !readOnly) onEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && editing) {
          e.stopPropagation();
          commitDraft();
          onEndEdit();
        }
      }}
    >
      <div ref={bodyRef} className="mp-tb-body" onPointerDown={onBodyPointerDown}>
        {editing ? (
          <MarkdownEditor
            documentId={`tb:${row.id}`}
            value={row.markdown ?? ""}
            mode="live"
            compact
            fontSize={fontPx}
            onChange={onChange}
            placeholder="写点什么…"
            onOpenPage={onOpenPage}
            handleRef={editorRef}
            autoFocus
            onBlur={() => {
              commitDraft();
              onEndEdit();
            }}
          />
        ) : row.markdown?.trim() ? (
          <MarkdownView source={row.markdown} onOpenPage={onOpenPage} />
        ) : (
          <div className="mp-tb-empty">{interactive ? "双击编辑" : "点击输入"}</div>
        )}
      </div>
      {framed && editing && EDGES.map((s) => <div key={s} className={`mp-tb-edge ${s}`} onPointerDown={(e) => startMove(e)} />)}
      {framed && HANDLES.map((h) => <div key={h} className={`mp-handle ${h}`} onPointerDown={startResize(h)} />)}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Convert a CSS box inside the page element back to a page-space rect. */
export function cssBoxToPage(geom: PageGeom, r: CssRect): { x: number; y: number; w: number; h: number } {
  const corners: [number, number][] = [
    toPage(geom, r.left, r.top),
    toPage(geom, r.left + r.width, r.top),
    toPage(geom, r.left, r.top + r.height),
    toPage(geom, r.left + r.width, r.top + r.height),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: round(x), y: round(y), w: round(Math.max(...xs) - x), h: round(Math.max(...ys) - y) };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
