import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { S } from "../core/strings";
import { Icon } from "../core/ui/Icon";
import { useSessionUi, useViewerState } from "../features/session/sessionStore";
import { useSettings } from "../stores/settings";
import { SelectionToolbar, type SelectionAction } from "./SelectionToolbar";
import { PdfViewerController } from "./viewerController";
import { createWheelPager } from "./wheelPaging";
import "./viewer.css";

interface Props {
  doc: PDFDocumentProxy | null;
  loading?: boolean;
  error?: string | null;
  initialPage?: number;
  selectionActions: SelectionAction["id"][];
  onSelectionAction: (id: SelectionAction["id"], text: string) => void;
  /** When set (e.g. highlight tool), a finished selection triggers this action instead of the toolbar. */
  autoAction?: SelectionAction["id"] | null;
  /** Overlay rendered above the pages (annotation layer, banners). */
  children?: React.ReactNode;
}

interface SelectionBox {
  x: number;
  y: number;
  text: string;
}

/** pdf.js PDFViewer host: zoom, wheel paging, text selection toolbar, page pill (docs/SPEC.md 6.5.4). */
export function PdfViewer({ doc, loading, error, initialPage = 0, selectionActions, onSelectionAction, autoAction = null, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<PdfViewerController | null>(null);
  const setController = useSessionUi((s) => s.setController);
  const setSelectionText = useSessionUi((s) => s.setSelectionText);
  const [selection, setSelection] = useState<SelectionBox | null>(null);

  // Create the controller once per mount.
  useEffect(() => {
    const container = containerRef.current;
    const viewerEl = viewerRef.current;
    if (!container || !viewerEl) return;
    const { viewMode, zoomMode } = useSettings.getState().settings;
    const ctrl = new PdfViewerController(container, viewerEl, { viewMode, scaleValue: zoomMode });
    ctrlRef.current = ctrl;
    setController(ctrl);
    const ro = new ResizeObserver(() => ctrl.refreshLayout());
    ro.observe(container);
    return () => {
      ro.disconnect();
      setController(null);
      ctrlRef.current = null;
      ctrl.destroy();
    };
  }, [setController]);

  useEffect(() => {
    if (doc && ctrlRef.current) ctrlRef.current.setDocument(doc, initialPage);
    // initialPage only matters at document load time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // Ctrl + wheel zooms around the cursor; plain wheel in single-page mode flips one page per
  // notch once the page cannot scroll any further (see wheelPaging.ts).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const pager = createWheelPager({ next: () => ctrlRef.current?.nextPage(), prev: () => ctrlRef.current?.previousPage() });
    const onWheel = (e: WheelEvent) => {
      const ctrl = ctrlRef.current;
      if (!ctrl) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const origin: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
        if (e.deltaY < 0) ctrl.zoomIn(origin);
        else ctrl.zoomOut(origin);
        return;
      }
      if (ctrl.state.viewMode !== "single") return;
      const atTop = container.scrollTop <= 0;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      const canScroll = container.scrollHeight > container.clientHeight + 1;
      if (canScroll && !((e.deltaY > 0 && atBottom) || (e.deltaY < 0 && atTop))) return;
      pager.handle(e);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  const clearSelectionUi = useCallback(() => {
    setSelection(null);
  }, []);

  // Actions that clear the DOM selection (highlight, excerpt, add to notes) also dismiss the toolbar.
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSelection(null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const onMouseUp = useCallback(() => {
    window.setTimeout(() => {
      const host = hostRef.current;
      const viewerEl = viewerRef.current;
      const sel = window.getSelection();
      if (!host || !viewerEl || !sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!viewerEl.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (!text) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      setSelectionText(text);
      if (autoActionRef.current) {
        onSelectionActionRef.current(autoActionRef.current, text);
        setSelection(null);
        return;
      }
      setSelection({ x: rect.left - hostRect.left + rect.width / 2, y: rect.top - hostRect.top - 8, text });
    }, 0);
  }, [setSelectionText]);
  const autoActionRef = useRef(autoAction);
  autoActionRef.current = autoAction;
  const onSelectionActionRef = useRef(onSelectionAction);
  onSelectionActionRef.current = onSelectionAction;

  const state = useViewerState();
  const [pageInput, setPageInput] = useState<string | null>(null);

  const submitPageInput = () => {
    const n = Number(pageInput);
    if (Number.isFinite(n) && n >= 1) ctrlRef.current?.goToPage(n - 1);
    setPageInput(null);
  };

  return (
    <div ref={hostRef} className="pdf-host" onMouseUp={onMouseUp} onMouseDown={clearSelectionUi} onScrollCapture={clearSelectionUi}>
      <div ref={containerRef} className="pdf-container">
        <div ref={viewerRef} className="pdfViewer" />
      </div>
      {children}
      {selection && (
        <SelectionToolbar
          x={selection.x}
          y={selection.y}
          enabled={selectionActions}
          onAction={(id) => {
            onSelectionAction(id, selection.text);
            if (id === "copy") setSelection(null);
          }}
        />
      )}
      {(loading || (!doc && !error)) && (
        <div className="pdf-overlay">
          <div className="pdf-skeleton" />
        </div>
      )}
      {error && (
        <div className="pdf-overlay">
          <span className="caption">{S.session.renderFailed}</span>
          <span className="caption" style={{ userSelect: "text" }}>
            {error}
          </span>
        </div>
      )}
      {doc && state.pageCount > 0 && (
        <div className="page-pill" role="group" aria-label={S.session.goToPage}>
          <button className="icon-btn" aria-label="上一页" onClick={() => ctrlRef.current?.previousPage()} disabled={state.currentPage <= 0}>
            <Icon name="chevron_left" size={20} />
          </button>
          {pageInput === null ? (
            <button className="page-pill-label body tabular" onClick={() => setPageInput(String(state.currentPage + 1))}>
              {S.session.pageOf(state.currentPage + 1, state.pageCount)}
            </button>
          ) : (
            <input
              className="input page-pill-input tabular"
              autoFocus
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={submitPageInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPageInput();
                if (e.key === "Escape") setPageInput(null);
                e.stopPropagation();
              }}
              aria-label={S.session.goToPage}
            />
          )}
          <button
            className="icon-btn"
            aria-label="下一页"
            onClick={() => ctrlRef.current?.nextPage()}
            disabled={state.currentPage >= state.pageCount - 1}
          >
            <Icon name="chevron_right" size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
