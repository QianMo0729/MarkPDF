import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { S } from "../../../core/strings";
import { useContextMenu } from "../../../core/ui/ContextMenu";
import { Icon } from "../../../core/ui/Icon";
import { toast } from "../../../core/ui/Toast";
import { useLiveQuery } from "../../../data/db/live";
import { pagesWithAnnotations } from "../../../data/db/repos/annotations";
import { getDeckPage } from "../../../data/db/repos/decks";
import { pagesWithNotes } from "../../../data/db/repos/notes";
import { activeOutlinePath, useOutline } from "../../../pdf/outline";
import { OutlineTree } from "../../../pdf/OutlineTree";
import { getThumbnailUrl } from "../../../pdf/thumbnails";
import { copyText } from "../../../platform/clipboard";
import { useSessionUi, useViewerState } from "../sessionStore";
import "./rail.css";

interface Props {
  deckId: string;
  doc: PDFDocumentProxy | null;
  pageSizes: { width: number; height: number }[];
  /** replay: pages never visited are dimmed (docs/SPEC.md 6.5.2). */
  visitedPages?: Set<number>;
  /** Current rail width in px (docs/SPEC.md 6.5.2); thumbnails are 16 px narrower. */
  width: number;
  onCollapse: () => void;
}

type RailTab = "thumbs" | "outline";

export function ThumbnailRail({ deckId, doc, pageSizes, visitedPages, width, onCollapse }: Props) {
  const [tab, setTab] = useState<RailTab>("thumbs");
  const controller = useSessionUi((s) => s.controller);
  const state = useViewerState();
  const { outline, loaded } = useOutline(doc);
  const hasOutline = outline.length > 0;
  const active = useMemo(() => activeOutlinePath(outline, state.currentPage), [outline, state.currentPage]);

  const notePages = useLiveQuery(() => pagesWithNotes(deckId), ["notes"], [deckId]);
  const annPages = useLiveQuery(() => pagesWithAnnotations(deckId), ["annotations"], [deckId]);
  const marked = useMemo(() => new Set([...(notePages.data ?? []), ...(annPages.data ?? [])]), [notePages.data, annPages.data]);

  const menu = useContextMenu();
  const openMenu = (e: React.MouseEvent, pageIndex: number) =>
    menu.open(e, [
      {
        label: S.session.copyPageText,
        icon: "content_copy",
        onClick: async () => {
          const page = await getDeckPage(deckId, pageIndex);
          await copyText(page?.text ?? "");
          toast("已复制");
        },
      },
    ]);

  return (
    <aside className="rail" style={{ width, flex: `0 0 ${width}px` }}>
      <div className="rail-tabs">
        <div className="segmented">
          <button className={tab === "thumbs" ? "selected" : ""} onClick={() => setTab("thumbs")} aria-label={S.session.thumbnails} title={S.session.thumbnails}>
            <Icon name="grid_view" size={16} />
          </button>
          <button
            className={tab === "outline" ? "selected" : ""}
            onClick={() => setTab("outline")}
            disabled={loaded && !hasOutline}
            aria-label={S.session.outline}
            title={loaded && !hasOutline ? S.session.noOutline : S.session.outline}
          >
            <Icon name="toc" size={16} />
          </button>
        </div>
      </div>
      <div className="rail-body">
        {tab === "thumbs" ? (
          <div className="rail-thumbs">
            {pageSizes.map((size, i) => (
              <ThumbItem
                key={i}
                deckId={deckId}
                doc={doc}
                index={i}
                aspect={size.height / size.width}
                width={width - 16}
                current={i === state.currentPage}
                marked={marked.has(i)}
                dimmed={visitedPages ? !visitedPages.has(i) : false}
                onClick={() => controller?.goToPage(i)}
                onContextMenu={(e) => openMenu(e, i)}
              />
            ))}
          </div>
        ) : (
          <OutlineTree nodes={outline} active={active} rowHeight={28} onSelect={(n) => controller?.goToDestination(n.dest)} />
        )}
      </div>
      <button className="icon-btn rail-collapse" aria-label="折叠" onClick={onCollapse}>
        <Icon name="chevron_left" size={20} />
      </button>
      {menu.element}
    </aside>
  );
}

interface ThumbItemProps {
  deckId: string;
  doc: PDFDocumentProxy | null;
  index: number;
  aspect: number;
  width: number;
  current: boolean;
  marked: boolean;
  dimmed: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function ThumbItem({ deckId, doc, index, aspect, width, current, marked, dimmed, onClick, onContextMenu }: ThumbItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)), {
      rootMargin: "200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !doc || url) return;
    let alive = true;
    getThumbnailUrl(deckId, index, () => Promise.resolve(doc))
      .then((u) => alive && setUrl(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visible, doc, deckId, index, url]);

  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const height = Math.round(width * (Number.isFinite(aspect) && aspect > 0 ? aspect : 0.5625));
  return (
    <button
      ref={ref}
      className={`thumb ${current ? "current" : ""} ${dimmed ? "dimmed" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={`第 ${index + 1} 页`}
      aria-current={current ? "page" : undefined}
    >
      <span className="thumb-img" style={{ width, height }}>
        {url && <img src={url} alt="" draggable={false} />}
        {marked && <span className="thumb-dot" />}
      </span>
      <span className="caption">{index + 1}</span>
    </button>
  );
}
