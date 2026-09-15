import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "../../data/db/live";
import { listAnnotations } from "../../data/db/repos/annotations";
import type { AnnotationRow } from "../../data/db/schema";
import { useSessionUi, useViewerState, type Tool } from "../../features/session/sessionStore";
import { CSS_PX_PER_PT, type PageGeom } from "../coords";
import { PageLayer } from "./PageLayer";
import "./annotations.css";

export interface LayerStyle {
  highlightColor: string;
  inkColor: string;
  inkWidth: number;
  textColor: string;
  fontSize: number;
  /** "" = none */
  borderColor: string;
  fillColor: string;
}

interface Props {
  deckId: string;
  pageSizes: { width: number; height: number }[];
  tool: Tool;
  style: LayerStyle;
  readOnly?: boolean;
  /** replay "当时的标注": rows supplied by the timeline instead of the DB. */
  overrideRows?: AnnotationRow[] | null;
  onOpenPage?: (page0: number) => void;
}

/** pdf.js events after which a page element may have been reset (children removed). */
const REATTACH_EVENTS = ["pagesinit", "pagerendered", "pagechanging", "scalechanging", "rotationchanging", "updateviewarea"];

/**
 * Mounts one PageLayer per page (docs/SPEC.md 6.5.5). pdf.js strips unknown
 * children from `.page` whenever it re-renders a page, so each layer lives in
 * a host element we own and re-append after every viewer event.
 */
export function AnnotationLayer({ deckId, pageSizes, tool, style, readOnly, overrideRows, onOpenPage }: Props) {
  const controller = useSessionUi((s) => s.controller);
  const state = useViewerState();
  const hostsRef = useRef<HTMLDivElement[]>([]);
  const [hosts, setHosts] = useState<HTMLDivElement[]>([]);

  useEffect(() => {
    if (!controller || state.pageCount === 0) {
      setHosts([]);
      return;
    }
    const attach = () => {
      const list = hostsRef.current;
      let changed = false;
      for (let i = 0; i < controller.state.pageCount; i++) {
        const div = controller.pageElement(i);
        if (!div) continue;
        let host = list[i];
        if (!host) {
          host = document.createElement("div");
          host.className = "mp-ann-host";
          list[i] = host;
          changed = true;
        }
        if (host.parentElement !== div) div.appendChild(host);
      }
      if (changed || list.length !== hosts.length) setHosts(list.slice(0, controller.state.pageCount));
    };
    // (dev) window.__annDebug was used to diagnose pdf.js resets; hosts are now re-appended on viewer events.
    attach();
    const bus = controller.eventBus;
    const handler = () => attach();
    for (const name of REATTACH_EVENTS) bus.on(name, handler);
    return () => {
      for (const name of REATTACH_EVENTS) bus.off(name, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, state.pageCount, state.pagesReady]);

  useEffect(
    () => () => {
      for (const h of hostsRef.current) h.remove();
      hostsRef.current = [];
    },
    [],
  );

  const rowsQuery = useLiveQuery(() => listAnnotations(deckId), ["annotations"], [deckId]);
  const rows = overrideRows ?? rowsQuery.data ?? [];
  const byPage = useMemo(() => {
    const map = new Map<number, AnnotationRow[]>();
    for (const r of rows) map.set(r.page_index, [...(map.get(r.page_index) ?? []), r]);
    return map;
  }, [rows]);

  return (
    <>
      {hosts.map((host, i) => {
        const size = pageSizes[i];
        const pageDiv = controller?.pageElement(i);
        if (!host || !size || !pageDiv) return null;
        const geom: PageGeom = { widthPt: size.width, heightPt: size.height, scale: state.scale * CSS_PX_PER_PT, rotation: state.rotation };
        return createPortal(
          <PageLayer
            key={i}
            deckId={deckId}
            pageIndex={i}
            pageDiv={pageDiv}
            geom={geom}
            rows={byPage.get(i) ?? []}
            tool={readOnly ? "select" : tool}
            style={style}
            readOnly={!!readOnly}
            onOpenPage={onOpenPage}
          />,
          host,
          `ann-${i}`,
        );
      })}
    </>
  );
}
