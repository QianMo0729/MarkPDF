import type { IDockviewPanelProps } from "dockview-react";
import { useMemo, useState } from "react";
import { S } from "../../../core/strings";
import { useContextMenu } from "../../../core/ui/ContextMenu";
import { Icon } from "../../../core/ui/Icon";
import { toast } from "../../../core/ui/Toast";
import { useLiveQuery } from "../../../data/db/live";
import { listAnnotations } from "../../../data/db/repos/annotations";
import type { AnnotationKind, AnnotationRow } from "../../../data/db/schema";
import { copyText } from "../../../platform/clipboard";
import { parseStrokes, useAnnotationStore } from "../controllers/annotations";
import { useMindmap } from "../controllers/mindmap";
import { activatePanel } from "../../../dock/DockHost";
import { useSessionUi, useViewerState } from "../sessionStore";
import "./panels.css";

const KIND_LABEL: Record<AnnotationKind, string> = { text_box: "文本框", highlight: "高亮", ink: "墨迹" };
const KIND_ICON: Record<AnnotationKind, string> = { text_box: "text_fields", highlight: "ink_highlighter", ink: "draw" };

interface Item {
  rows: AnnotationRow[];
  head: AnnotationRow;
}

/** Group ink strokes of the same color created within 5 s into one list item (docs/SPEC.md 6.5.8). */
function groupRows(rows: AnnotationRow[]): Item[] {
  const items: Item[] = [];
  for (const r of rows) {
    const last = items[items.length - 1];
    if (r.kind === "ink" && last && last.head.kind === "ink" && last.head.page_index === r.page_index && last.head.color === r.color && Math.abs(Date.parse(r.created_at) - Date.parse(last.rows[last.rows.length - 1].created_at)) <= 5000) {
      last.rows.push(r);
    } else items.push({ rows: [r], head: r });
  }
  return items;
}

export function AnnotationsPanel(_props: IDockviewPanelProps) {
  const deckId = useSessionUi((s) => s.deckId);
  const controller = useSessionUi((s) => s.controller);
  const page = useViewerState().currentPage;
  const [scope, setScope] = useState<"page" | "all">("page");
  const [kinds, setKinds] = useState<Set<AnnotationKind>>(new Set(["text_box", "highlight", "ink"]));
  const store = useAnnotationStore();
  const menu = useContextMenu();
  const all = useLiveQuery(() => (deckId ? listAnnotations(deckId) : Promise.resolve([])), ["annotations"], [deckId]);

  const items = useMemo(() => {
    const rows = (all.data ?? []).filter((r) => kinds.has(r.kind) && (scope === "all" || r.page_index === page)).sort((a, b) => a.page_index - b.page_index || a.created_at.localeCompare(b.created_at));
    return groupRows(rows);
  }, [all.data, kinds, scope, page]);

  const go = (r: AnnotationRow) => {
    controller?.goToPage(r.page_index);
    store.select(r.id);
    store.flash(r.id);
  };

  const toMarkdown = (r: AnnotationRow) => (r.kind === "highlight" ? `> ${r.selected_text ?? ""}${r.markdown ? `\n${r.markdown}` : ""}` : (r.markdown ?? ""));

  const openMenu = (e: React.MouseEvent, item: Item) =>
    menu.open(e, [
      {
        label: "复制为 Markdown",
        icon: "content_copy",
        disabled: item.head.kind === "ink",
        onClick: async () => {
          await copyText(toMarkdown(item.head));
          toast("已复制");
        },
      },
      {
        label: S.mindmap.addToMap,
        icon: "account_tree",
        disabled: item.head.kind === "ink",
        onClick: async () => {
          if (!deckId) return;
          const api = useSessionUi.getState().dockApi;
          if (api) activatePanel(api, "mindmap");
          await useMindmap.getState().addExcerpt(deckId, item.head);
        },
      },
      {
        label: S.common.delete,
        icon: "delete",
        danger: true,
        onClick: async () => {
          for (const r of item.rows) await store.remove(r.id);
        },
      },
    ]);

  const toggleKind = (k: AnnotationKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="panel">
      <div className="panel-head" style={{ justifyContent: "space-between" }}>
        <div className="segmented">
          <button className={scope === "page" ? "selected" : ""} onClick={() => setScope("page")}>
            本页
          </button>
          <button className={scope === "all" ? "selected" : ""} onClick={() => setScope("all")}>
            全部
          </button>
        </div>
        <div className="row" style={{ gap: 4 }}>
          {(["text_box", "highlight", "ink"] as AnnotationKind[]).map((k) => (
            <button key={k} className={`icon-btn ${kinds.has(k) ? "active" : ""}`} style={{ width: 28, height: 28 }} aria-pressed={kinds.has(k)} title={KIND_LABEL[k]} aria-label={KIND_LABEL[k]} onClick={() => toggleKind(k)}>
              <Icon name={KIND_ICON[k]} size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body scroll-y">
        {!all.loading && items.length === 0 && (
          <div className="empty">
            <Icon name="format_ink_highlighter" size={40} />
            <div className="body-small">{scope === "page" ? "这一页还没有标注" : "还没有标注"}</div>
            <div className="caption">用工具栏的高亮、绘制、添加文本在页面上做标注。</div>
          </div>
        )}
        {items.map((item) => {
          const r = item.head;
          return (
            <button key={r.id} className="ann-item" onClick={() => go(r)} onContextMenu={(e) => openMenu(e, item)}>
              <span className="ann-bar" style={{ background: r.color }} />
              <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="caption">
                  第 {r.page_index + 1} 页  {KIND_LABEL[r.kind]}
                </span>
                {r.kind === "text_box" && <span className="body ann-text">{(r.markdown ?? "").trim() || "（空文本框）"}</span>}
                {r.kind === "highlight" && (
                  <>
                    <span className="body ann-text">{r.selected_text}</span>
                    {r.markdown && <span className="body-small text2 ann-text">{r.markdown}</span>}
                  </>
                )}
                {r.kind === "ink" && <span className="body-small text2">墨迹  {item.rows.reduce((n, x) => n + parseStrokes(x).length, 0)} 笔</span>}
              </span>
            </button>
          );
        })}
      </div>
      {menu.element}
    </div>
  );
}
