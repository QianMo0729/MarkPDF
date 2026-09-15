import type { IDockviewPanelProps } from "dockview-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { S } from "../../../core/strings";
import { Icon } from "../../../core/ui/Icon";
import { useLiveQuery } from "../../../data/db/live";
import { listAnnotations } from "../../../data/db/repos/annotations";
import { listNodes } from "../../../data/db/repos/mindmap";
import type { AnnotationRow, MindmapNodeRow } from "../../../data/db/schema";
import { boundsOf, DEFAULT_SIZE, edgePath, layoutTree, type Placed, type Size } from "../../../domain/mindmap_layout";
import { MarkdownEditor } from "../../../editor/MarkdownEditor";
import { MarkdownView } from "../../../editor/MarkdownView";
import { useAnnotationStore } from "../controllers/annotations";
import { excerptText, useMindmap } from "../controllers/mindmap";
import { useSessionUi } from "../sessionStore";
import "./panels.css";
import "./mindmap.css";

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

/** MarginNote-style mind map: excerpt cards in a tree, linked back to the PDF (docs/SPEC.md 6.5.19). */
export function MindmapPanel(props: IDockviewPanelProps) {
  const deckId = useSessionUi((s) => s.deckId);
  const controller = useSessionUi((s) => s.controller);
  const mm = useMindmap();
  const nodesQ = useLiveQuery(() => (deckId ? listNodes(deckId) : Promise.resolve([])), ["mindmap_nodes"], [deckId]);
  const annQ = useLiveQuery(() => (deckId ? listAnnotations(deckId) : Promise.resolve([])), ["annotations"], [deckId]);
  const nodes = nodesQ.data ?? [];
  const annotations = useMemo(() => new Map((annQ.data ?? []).map((a) => [a.id, a])), [annQ.data]);

  const [sizes, setSizes] = useState<Map<string, Size>>(new Map());
  const placed = useMemo(
    () => layoutTree(nodes.map((n) => ({ id: n.id, parentId: n.parent_id, order: n.order_index, collapsed: !!n.collapsed })), sizes),
    [nodes, sizes],
  );
  // ----- pan / zoom -----
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 24, y: 24, z: 1 });
  const fitted = useRef(false);
  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host || placed.size === 0) return;
    const b = boundsOf(placed.values());
    const w = b.maxX - b.minX + 48;
    const h = b.maxY - b.minY + 48;
    const z = Math.max(MIN_ZOOM, Math.min(1, Math.min(host.clientWidth / w, host.clientHeight / h)));
    setView({ x: 24 - b.minX * z, y: 24 - b.minY * z, z });
  }, [placed]);
  useEffect(() => {
    if (!fitted.current && placed.size > 0 && sizes.size > 0) {
      fitted.current = true;
      fit();
    }
  }, [placed, sizes, fit]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = host.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        setView((v) => {
          const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
          const k = z / v.z;
          return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, z };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }));
      }
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, []);

  const panStart = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".mm-node")) return;
    mm.select(null);
    const sx = e.clientX;
    const sy = e.clientY;
    const start = view;
    const onMove = (ev: PointerEvent) => setView({ ...start, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Reveal newly added / selected nodes.
  useEffect(() => {
    if (!mm.reveal) return;
    const p = placed.get(mm.reveal.id);
    const host = hostRef.current;
    if (!p || !host) return;
    setView((v) => {
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const sx = cx * v.z + v.x;
      const sy = cy * v.z + v.y;
      const inside = sx > 40 && sx < host.clientWidth - 40 && sy > 40 && sy < host.clientHeight - 40;
      return inside ? v : { ...v, x: host.clientWidth / 2 - cx * v.z, y: host.clientHeight / 2 - cy * v.z };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mm.reveal?.nonce, placed.size]);

  // ----- drag to reparent -----
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const startDrag = (e: React.PointerEvent, node: MindmapNodeRow) => {
    if (e.button !== 0 || node.kind === "root" || mm.editingId === node.id) return;
    e.stopPropagation();
    mm.select(node.id);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const target = el?.closest<HTMLElement>(".mm-node")?.dataset.id ?? null;
      setDrag({ id: node.id, x: ev.clientX, y: ev.clientY, over: target && target !== node.id ? target : null });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const target = el?.closest<HTMLElement>(".mm-node")?.dataset.id ?? null;
        if (target && target !== node.id) void mm.reparent(node.id, target);
      } else {
        // A press without travel is the click: jump right away. The DOM click can be
        // swallowed by the re-render that selecting triggers, which used to cost a second click.
        jump(node);
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ----- keyboard -----
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!deckId || mm.editingId) return;
    const sel = mm.selectedId;
    if (e.key === "Tab" && sel) {
      e.preventDefault();
      void mm.addChild(deckId, sel);
    } else if (e.key === "Enter" && sel) {
      e.preventDefault();
      void mm.addSibling(deckId, sel);
    } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
      e.preventDefault();
      void mm.remove(sel);
    } else if (e.key === "F2" && sel) {
      e.preventDefault();
      mm.edit(sel);
    } else if (e.key === " " && sel) {
      e.preventDefault();
      void mm.toggleCollapsed(sel);
    }
    e.stopPropagation();
  };

  const jump = (node: MindmapNodeRow) => {
    if (node.page_index === null) return;
    controller?.goToPage(node.page_index);
    if (node.annotation_id) {
      useAnnotationStore.getState().select(node.annotation_id);
      useAnnotationStore.getState().flash(node.annotation_id);
    }
  };

  const onSizeChange = useCallback((id: string, size: Size) => {
    setSizes((prev) => {
      const old = prev.get(id);
      if (old && Math.abs(old.w - size.w) < 0.5 && Math.abs(old.h - size.h) < 0.5) return prev;
      const next = new Map(prev);
      next.set(id, size);
      return next;
    });
  }, []);

  const maximize = () => {
    const g = props.api.group as unknown as { api?: { isMaximized?: () => boolean; maximize?: () => void; exitMaximized?: () => void } };
    if (!g?.api?.maximize) return;
    if (g.api.isMaximized?.()) g.api.exitMaximized?.();
    else g.api.maximize();
  };

  if (!deckId) return null;

  return (
    <div className="panel mindmap-panel">
      <div className="panel-head mm-head">
        <button className="icon-btn" title="添加子节点 (Tab)" aria-label="添加子节点" onClick={() => void mm.addChild(deckId, mm.selectedId)}>
          <Icon name="subdirectory_arrow_right" size={20} />
        </button>
        <button className="icon-btn" title="添加同级节点 (Enter)" aria-label="添加同级节点" disabled={!mm.selectedId} onClick={() => mm.selectedId && void mm.addSibling(deckId, mm.selectedId)}>
          <Icon name="add" size={20} />
        </button>
        <button className="icon-btn" title="删除 (Delete)" aria-label="删除" disabled={!mm.selectedId} onClick={() => mm.selectedId && void mm.remove(mm.selectedId)}>
          <Icon name="delete" size={20} />
        </button>
        <span className="grow" />
        <button className="icon-btn" title="适应窗口" aria-label="适应窗口" onClick={fit}>
          <Icon name="fit_screen" size={20} />
        </button>
        <button className="icon-btn" title="缩小" aria-label="缩小" onClick={() => setView((v) => ({ ...v, z: Math.max(MIN_ZOOM, v.z / 1.2) }))}>
          <Icon name="remove" size={20} />
        </button>
        <span className="caption tabular" style={{ minWidth: 36, textAlign: "center" }}>
          {Math.round(view.z * 100)}%
        </span>
        <button className="icon-btn" title="放大" aria-label="放大" onClick={() => setView((v) => ({ ...v, z: Math.min(MAX_ZOOM, v.z * 1.2) }))}>
          <Icon name="add" size={20} />
        </button>
        <button className="icon-btn" title="最大化面板" aria-label="最大化面板" onClick={maximize}>
          <Icon name="open_in_full" size={20} />
        </button>
      </div>
      <div ref={hostRef} className="mm-canvas" tabIndex={0} onPointerDown={panStart} onKeyDown={onKeyDown}>
        {nodes.length === 0 && (
          <div className="empty" style={{ height: "100%" }}>
            <Icon name="account_tree" size={40} />
            <div className="subtitle" style={{ color: "var(--text)" }}>
              {S.mindmap.emptyTitle}
            </div>
            <div className="body-small">{S.mindmap.emptyBody}</div>
            <button className="btn btn-filled" onClick={() => void mm.addChild(deckId, null)}>
              {S.mindmap.start}
            </button>
          </div>
        )}
        <div className="mm-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className="mm-edges">
            {nodes.map((n) => {
              if (!n.parent_id) return null;
              const p = placed.get(n.parent_id);
              const c = placed.get(n.id);
              if (!p || !c) return null;
              return <path key={n.id} d={edgePath(p, c)} />;
            })}
          </svg>
          {nodes.map((n) => {
            const p = placed.get(n.id);
            if (!p) return null;
            const hasChildren = nodes.some((c) => c.parent_id === n.id);
            return (
              <NodeCard
                key={n.id}
                node={n}
                placed={p}
                annotation={n.annotation_id ? annotations.get(n.annotation_id) : undefined}
                selected={mm.selectedId === n.id}
                editing={mm.editingId === n.id}
                dropTarget={drag?.over === n.id}
                dragging={drag?.id === n.id}
                hasChildren={hasChildren}
                onSize={onSizeChange}
                onPointerDown={(e) => startDrag(e, n)}
                onClick={() => mm.select(n.id)}
                onDoubleClick={() => mm.edit(n.id)}
                onEndEdit={() => mm.editingId === n.id && mm.edit(null)}
                onChange={(md) => void mm.setMarkdown(n.id, md)}
                onToggle={() => void mm.toggleCollapsed(n.id)}
              />
            );
          })}
        </div>
        {drag && (
          <div className="mm-drag-ghost caption" style={{ left: drag.x - (hostRef.current?.getBoundingClientRect().left ?? 0) + 12, top: drag.y - (hostRef.current?.getBoundingClientRect().top ?? 0) + 12 }}>
            {drag.over ? "放到这个节点下" : "拖到目标节点上"}
          </div>
        )}
      </div>
    </div>
  );
}

interface CardProps {
  node: MindmapNodeRow;
  placed: Placed;
  annotation?: AnnotationRow;
  selected: boolean;
  editing: boolean;
  dropTarget: boolean;
  dragging: boolean;
  hasChildren: boolean;
  onSize: (id: string, size: Size) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
  onDoubleClick: () => void;
  onEndEdit: () => void;
  onChange: (md: string) => void;
  onToggle: () => void;
}

function NodeCard({ node, placed, annotation, selected, editing, dropTarget, dragging, hasChildren, onSize, onPointerDown, onClick, onDoubleClick, onEndEdit, onChange, onToggle }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const draft = useRef(node.markdown);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onSize(node.id, { w: el.offsetWidth, h: el.offsetHeight });
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => ro.disconnect();
  }, [node.id, onSize]);

  useEffect(() => {
    draft.current = node.markdown;
  }, [node.markdown]);

  const commit = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (draft.current !== node.markdown) onChange(draft.current);
  };

  const excerpt = excerptText(annotation);
  const cls = ["mm-node", `kind-${node.kind}`, selected ? "selected" : "", editing ? "editing" : "", dropTarget ? "drop" : "", dragging ? "dragging" : ""].filter(Boolean).join(" ");
  const accent = node.color ?? annotation?.color ?? undefined;

  return (
    <div
      ref={ref}
      data-id={node.id}
      className={cls}
      style={{ left: placed.x, top: placed.y, width: node.kind === "root" ? DEFAULT_SIZE.w : undefined, "--mm-accent": accent } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && editing) {
          e.stopPropagation();
          commit();
          onEndEdit();
        }
      }}
    >
      {node.kind === "excerpt" && excerpt && (
        <div className="mm-excerpt">
          <span className="mm-page">P{(node.page_index ?? 0) + 1}</span>
          <span className="mm-excerpt-text">{excerpt}</span>
        </div>
      )}
      <div className="mm-body">
        {editing ? (
          <MarkdownEditor
            documentId={`mm:${node.id}`}
            value={node.markdown}
            mode="live"
            compact
            fontSize={14}
            placeholder={node.kind === "excerpt" ? "写点想法…" : "节点内容…"}
            onChange={(md) => {
              draft.current = md;
              if (timer.current) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(commit, 600);
            }}
            onBlur={() => {
              commit();
              onEndEdit();
            }}
            autoFocus
          />
        ) : node.markdown.trim() ? (
          <MarkdownView source={node.markdown} />
        ) : node.kind !== "excerpt" ? (
          <span className="caption">双击编辑</span>
        ) : null}
      </div>
      {hasChildren && (
        <button
          className={`mm-toggle ${node.collapsed ? "collapsed" : ""}`}
          aria-label={node.collapsed ? "展开" : "折叠"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <Icon name={node.collapsed ? "add" : "remove"} size={12} />
        </button>
      )}
    </div>
  );
}
