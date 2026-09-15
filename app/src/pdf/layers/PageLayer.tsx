import { useCallback, useEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS, INK_COLORS, TEXT_BOX_FILL_COLORS } from "../../core/palette";
import { S } from "../../core/strings";
import { Icon } from "../../core/ui/Icon";
import { toast } from "../../core/ui/Toast";
import type { AnnotationRow } from "../../data/db/schema";
import { parseQuads, parseStrokes, useAnnotationStore } from "../../features/session/controllers/annotations";
import type { Tool } from "../../features/session/sessionStore";
import { copyText } from "../../platform/clipboard";
import { useSettings } from "../../stores/settings";
import { quadToCss, rectToCss, toCss, toPage, type CssRect, type PageGeom } from "../coords";
import type { LayerStyle } from "./AnnotationLayer";
import { quadHit, simplify, strokeHit, strokeToPath, type Point, type Stroke } from "./geometry";
import { HighlightPopover } from "./HighlightPopover";
import { TextBoxAnnotation } from "./TextBoxAnnotation";

interface Props {
  deckId: string;
  pageIndex: number;
  pageDiv: HTMLElement;
  geom: PageGeom;
  rows: AnnotationRow[];
  tool: Tool;
  style: LayerStyle;
  readOnly: boolean;
  onOpenPage?: (page0: number) => void;
}

const INK_WIDTHS = [1, 2, 4, 8];
const FONT_SIZES = [12, 16, 20, 24, 32];
const TEXT_BOX_DEFAULT = { w: 260, h: 40 };
const TEXT_BOX_MIN = { w: 60, h: 24 };

/** One page's worth of annotations plus the tool interactions (docs/SPEC.md 6.5.5). */
export function PageLayer({ deckId, pageIndex, pageDiv, geom, rows, tool, style, readOnly, onOpenPage }: Props) {
  const store = useAnnotationStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const [liveStroke, setLiveStroke] = useState<Stroke | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const gesture = useRef<{ kind: "draw" | "text" | "erase"; points: Stroke; start: Point; moved: boolean; erased: Set<string> } | null>(null);

  const pagePoint = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const r = pageDiv.getBoundingClientRect();
      return toPage(geom, e.clientX - r.left, e.clientY - r.top);
    },
    [pageDiv, geom],
  );

  // ----- select tool: hit-test highlights / ink on click (the layer itself is pointer-events: none) -----
  useEffect(() => {
    if (tool !== "select") return;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(".mp-tb, .mp-minibar, .mp-popover, .mp-hl-note")) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const p = pagePoint(e);
      const sorted = [...rows].sort((a, b) => b.z - a.z);
      const hl = sorted.find((r) => r.kind === "highlight" && quadHit(parseQuads(r), p));
      if (hl) {
        store.openPopover(hl.id);
        return;
      }
      const ink = sorted.find((r) => r.kind === "ink" && parseStrokes(r).some((s) => strokeHit(s, p, (r.stroke_width ?? 2) / 2 + 4 / geom.scale)));
      if (ink) {
        store.select(ink.id);
        return;
      }
      if (store.selectedId && rows.some((r) => r.id === store.selectedId)) store.select(null);
      if (store.popoverId && rows.some((r) => r.id === store.popoverId)) store.openPopover(null);
    };
    pageDiv.addEventListener("click", onClick);
    return () => pageDiv.removeEventListener("click", onClick);
  }, [tool, pageDiv, rows, pagePoint, geom.scale, store]);

  // ----- draw / text / erase tools -----
  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly || e.button !== 0) return;
    if (tool === "draw" && e.pointerType === "touch") return;
    if (tool !== "draw" && tool !== "text" && tool !== "erase") return;
    // Clicks on an existing text box (or its popovers) belong to that box, never to a new gesture.
    if ((e.target as HTMLElement).closest(".mp-tb, .mp-minibar, .mp-popover")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pagePoint(e);
    gesture.current = { kind: tool, points: [p], start: p, moved: false, erased: new Set() };
    if (tool === "draw") setLiveStroke([p]);
    if (tool === "erase") eraseAt(p, gesture.current.erased);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    // Coalesced events add fidelity for pens; for mouse/touch (and synthetic events) they can carry stale samples.
    const native = e.nativeEvent as PointerEvent;
    let events: PointerEvent[] = [native];
    if (native.pointerType === "pen" && typeof native.getCoalescedEvents === "function") {
      const coalesced = native.getCoalescedEvents().filter((ev) => ev.pointerId === native.pointerId);
      if (coalesced.length) events = coalesced;
    }
    for (const ev of events) {
      const p = pagePoint(ev);
      if (Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) * geom.scale > 6) g.moved = true;
      if (g.kind === "draw") g.points.push(p);
      else if (g.kind === "erase") eraseAt(p, g.erased);
      else if (g.kind === "text") {
        setDragRect({ x: Math.min(g.start[0], p[0]), y: Math.min(g.start[1], p[1]), w: Math.abs(p[0] - g.start[0]), h: Math.abs(p[1] - g.start[1]) });
      }
    }
    if (g.kind === "draw") setLiveStroke([...g.points]);
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setLiveStroke(null);
    setDragRect(null);
    if (!g) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (g.kind === "draw") {
      const pts = simplify(g.points, 0.5);
      if (pts.length >= 1) await store.createInk(deckId, pageIndex, pts, style.inkColor, style.inkWidth);
    } else if (g.kind === "text") {
      const end = pagePoint(e);
      let x: number, y: number, w: number, h: number;
      if (g.moved) {
        x = Math.min(g.start[0], end[0]);
        y = Math.min(g.start[1], end[1]);
        w = Math.max(TEXT_BOX_MIN.w, Math.abs(end[0] - g.start[0]));
        h = Math.max(TEXT_BOX_MIN.h, Math.abs(end[1] - g.start[1]));
      } else {
        x = g.start[0];
        y = g.start[1];
        w = TEXT_BOX_DEFAULT.w;
        h = TEXT_BOX_DEFAULT.h;
      }
      x = Math.max(0, Math.min(geom.widthPt - w, x));
      y = Math.max(0, Math.min(geom.heightPt - h, y));
      const fontSize = style.fontSize > 0 ? style.fontSize : Math.max(12, Math.min(48, Math.round(18 / geom.scale)));
      const id = await store.createTextBox(deckId, pageIndex, x, y, w, h, { color: style.textColor, fontSize, borderColor: style.borderColor || null, fillColor: style.fillColor || null });
      store.edit(id);
    }
  };

  const eraseAt = (p: Point, erased: Set<string>) => {
    for (const r of rows) {
      if (erased.has(r.id)) continue;
      const hit =
        (r.kind === "ink" && parseStrokes(r).some((s) => strokeHit(s, p, (r.stroke_width ?? 2) / 2 + 4 / geom.scale))) ||
        (r.kind === "highlight" && quadHit(parseQuads(r), p));
      if (hit) {
        erased.add(r.id);
        void store.remove(r.id);
      }
    }
  };

  // Highlighting selects text in pdf.js's text layer, so the layer must stay transparent for it.
  const active = tool === "draw" || tool === "text" || tool === "erase";
  const selected = rows.find((r) => r.id === store.selectedId) ?? null;
  const popover = rows.find((r) => r.id === store.popoverId && r.kind === "highlight") ?? null;

  const bboxCss = (r: AnnotationRow): CssRect =>
    r.kind === "highlight" ? unionCss(parseQuads(r).map((q) => quadToCss(geom, q))) : rectToCss(geom, r.x, r.y, r.w, r.h);

  return (
    <div
      ref={hostRef}
      className={`mp-ann-layer ${active ? "tool-active" : ""} tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {rows
        .filter((r) => r.kind === "highlight")
        .map((r) => (
          <HighlightView key={r.id} row={r} geom={geom} selected={store.selectedId === r.id || store.popoverId === r.id} flash={store.flashId === r.id} onNoteClick={() => store.openPopover(r.id)} />
        ))}

      <svg className={`mp-ink ${tool === "select" ? "selectable" : ""}`}>
        {rows
          .filter((r) => r.kind === "ink")
          .map((r) => {
            const width = (r.stroke_width ?? 2) * geom.scale;
            return parseStrokes(r).map((s, i) => (
              <path
                key={`${r.id}-${i}`}
                className={store.selectedId === r.id || store.flashId === r.id ? "selected" : ""}
                d={strokeToPath(s.map(([x, y]) => toCss(geom, x, y)))}
                stroke={r.color}
                strokeWidth={width}
                onClick={tool === "select" ? () => store.select(r.id) : undefined}
              />
            ));
          })}
        {liveStroke && (
          <g className="mp-ink-live">
            <path d={strokeToPath(liveStroke.map(([x, y]) => toCss(geom, x, y)))} stroke={style.inkColor} strokeWidth={style.inkWidth * geom.scale} />
          </g>
        )}
      </svg>

      {dragRect && (
        <div
          style={{
            position: "absolute",
            ...cssRectStyle(rectToCss(geom, dragRect.x, dragRect.y, dragRect.w, dragRect.h)),
            border: "1px dashed var(--accent)",
            pointerEvents: "none",
          }}
        />
      )}

      {rows
        .filter((r) => r.kind === "text_box")
        .map((r) => (
          <TextBoxAnnotation
            key={r.id}
            row={r}
            geom={geom}
            selected={store.selectedId === r.id}
            editing={store.editingId === r.id}
            flash={store.flashId === r.id}
            readOnly={readOnly}
            interactive={tool === "select"}
            editOnClick={tool === "text"}
            onSelect={() => store.select(r.id)}
            onEdit={() => !readOnly && store.edit(r.id)}
            onEndEdit={() => store.editingId === r.id && store.edit(null)}
            onCommit={(patch, undoable) => store.update(r.id, patch, undoable)}
            onOpenPage={onOpenPage}
          />
        ))}

      {selected && !readOnly && tool === "select" && store.editingId !== selected.id && selected.kind === "ink" && (
        <MiniBar
          rect={bboxCss(selected)}
          colors={INK_COLORS}
          color={selected.color}
          onColor={(c) => store.update(selected.id, { color: c })}
          sizes={INK_WIDTHS}
          size={selected.stroke_width ?? 2}
          sizeLabel="pt"
          onSize={(v) => store.update(selected.id, { stroke_width: v })}
          onDelete={() => store.remove(selected.id)}
        />
      )}
      {selected && !readOnly && (tool === "select" || tool === "text") && selected.kind === "text_box" && (
        <TextBoxMiniBar rect={bboxCss(selected)} row={selected} onPatch={(patch) => void store.update(selected.id, patch)} onDelete={() => store.remove(selected.id)} />
      )}

      {popover && (
        <HighlightPopover
          row={popover}
          anchor={bboxCss(popover)}
          colors={HIGHLIGHT_COLORS}
          readOnly={readOnly}
          onColor={(c) => store.update(popover.id, { color: c })}
          onComment={(md) => store.update(popover.id, { markdown: md }, false)}
          onCopy={async () => {
            await copyText(popover.selected_text ?? "");
            toast("已复制");
          }}
          onDelete={() => store.remove(popover.id)}
          onClose={() => store.openPopover(null)}
        />
      )}
    </div>
  );
}

function HighlightView({ row, geom, selected, flash, onNoteClick }: { row: AnnotationRow; geom: PageGeom; selected: boolean; flash: boolean; onNoteClick: () => void }) {
  const quads = parseQuads(row);
  const rects = quads.map((q) => quadToCss(geom, q));
  const last = rects[rects.length - 1];
  return (
    <>
      {rects.map((r, i) => (
        <div key={i} className={`mp-hl ${selected ? "selected" : ""} ${flash ? "flash" : ""}`} style={{ ...cssRectStyle(r), background: row.color }} />
      ))}
      {row.markdown && last && (
        <span className="mp-hl-note material-symbols-rounded" style={{ left: last.left + last.width - 6, top: last.top - 8, color: row.color }} onClick={onNoteClick} title={S.tools.note}>
          chat_bubble
        </span>
      )}
    </>
  );
}

function MiniBar({ rect, colors, color, onColor, sizes, size, sizeLabel, onSize, onDelete }: { rect: CssRect; colors: string[]; color: string; onColor: (c: string) => void; sizes: number[]; size: number; sizeLabel: string; onSize: (v: number) => void; onDelete: () => void }) {
  const [sizeOpen, setSizeOpen] = useState(false);
  return (
    <div className="mp-minibar" style={{ left: rect.left, top: Math.max(0, rect.top - 34) }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {colors.map((c) => (
        <button key={c} className={`tool-swatch ${c.toLowerCase() === color.toLowerCase() ? "selected" : ""}`} style={{ background: c }} aria-label={c} onClick={() => onColor(c)} />
      ))}
      <span className="toolbar-sep" />
      <button className="btn btn-text toolbar-small" style={{ height: 24 }} onClick={() => setSizeOpen((v) => !v)}>
        {size} {sizeLabel}
      </button>
      {sizeOpen && (
        <div className="row" style={{ gap: 2 }}>
          {sizes.map((v) => (
            <button
              key={v}
              className={`chip ${v === size ? "selected" : ""}`}
              onClick={() => {
                onSize(v);
                setSizeOpen(false);
              }}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      <button className="icon-btn" aria-label={S.common.delete} title={S.common.delete} onClick={onDelete}>
        <Icon name="delete" size={18} />
      </button>
    </div>
  );
}

/** Text box mini bar: text colour, size, border, fill, delete. Stays open while editing (docs/SPEC.md 6.5.5). */
function TextBoxMiniBar({ rect, row, onPatch, onDelete }: { rect: CssRect; row: AnnotationRow; onPatch: (patch: Partial<AnnotationRow>) => void; onDelete: () => void }) {
  const [open, setOpen] = useState<"size" | "border" | "fill" | null>(null);
  const setDefault = useSettings((s) => s.set);
  const fontSize = row.font_size ?? 20;
  // Every change also becomes the default for the next box.
  const color = (c: string) => {
    onPatch({ color: c });
    void setDefault("textColor", c);
  };
  const size = (v: number) => {
    onPatch({ font_size: v });
    void setDefault("textBoxFontSize", v);
    setOpen(null);
  };
  const border = (c: string) => {
    onPatch({ border_color: c || null });
    void setDefault("textBoxBorderColor", c);
    setOpen(null);
  };
  const fill = (c: string) => {
    onPatch({ fill_color: c || null });
    void setDefault("textBoxFillColor", c);
    setOpen(null);
  };
  return (
    <div
      className="mp-minibar"
      style={{ left: rect.left, top: Math.max(0, rect.top - 34) }}
      onPointerDown={(e) => {
        // preventDefault keeps focus (and the editing state) inside the box while picking options.
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <SwatchRow colors={INK_COLORS} value={row.color} onChange={color} />
      <span className="toolbar-sep" />
      <button className="btn btn-text toolbar-small" style={{ height: 24 }} onClick={() => setOpen(open === "size" ? null : "size")}>
        {fontSize} pt
      </button>
      <button className={`icon-btn ${open === "border" ? "active" : ""}`} aria-label={S.tools.border} title={S.tools.border} onClick={() => setOpen(open === "border" ? null : "border")}>
        <Icon name="border_color" size={18} />
      </button>
      <button className={`icon-btn ${open === "fill" ? "active" : ""}`} aria-label={S.tools.fill} title={S.tools.fill} onClick={() => setOpen(open === "fill" ? null : "fill")}>
        <Icon name="format_color_fill" size={18} />
      </button>
      {open === "size" && (
        <div className="row" style={{ gap: 2 }}>
          {FONT_SIZES.map((v) => (
            <button key={v} className={`chip ${v === fontSize ? "selected" : ""}`} onClick={() => size(v)}>
              {v}
            </button>
          ))}
        </div>
      )}
      {open === "border" && <SwatchRow colors={INK_COLORS} value={row.border_color ?? ""} allowNone onChange={border} />}
      {open === "fill" && <SwatchRow colors={TEXT_BOX_FILL_COLORS} value={row.fill_color ?? ""} allowNone onChange={fill} />}
      <button className="icon-btn" aria-label={S.common.delete} title={S.common.delete} onClick={onDelete}>
        <Icon name="delete" size={18} />
      </button>
    </div>
  );
}

function SwatchRow({ colors, value, allowNone, onChange }: { colors: string[]; value: string; allowNone?: boolean; onChange: (c: string) => void }) {
  return (
    <>
      {allowNone && <button className={`tool-swatch none ${value === "" ? "selected" : ""}`} aria-label={S.tools.none} title={S.tools.none} onClick={() => onChange("")} />}
      {colors.map((c) => (
        <button key={c} className={`tool-swatch ${c.toLowerCase() === value.toLowerCase() ? "selected" : ""}`} style={{ background: c }} aria-label={c} onClick={() => onChange(c)} />
      ))}
    </>
  );
}

function unionCss(rects: CssRect[]): CssRect {
  if (!rects.length) return { left: 0, top: 0, width: 0, height: 0 };
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

export function cssRectStyle(r: CssRect): React.CSSProperties {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
