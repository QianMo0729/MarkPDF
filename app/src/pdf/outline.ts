import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  /** Resolved lazily; -1 while unknown. */
  pageIndex: number;
  items: OutlineNode[];
}

interface RawOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutlineItem[];
}

async function resolvePage(doc: PDFDocumentProxy, dest: string | unknown[] | null): Promise<number> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    const ref = explicit?.[0];
    if (ref && typeof ref === "object") return await doc.getPageIndex(ref as never);
    if (typeof ref === "number") return ref;
  } catch {
    /* unresolvable destination */
  }
  return -1;
}

async function build(doc: PDFDocumentProxy, raw: RawOutlineItem[]): Promise<OutlineNode[]> {
  return Promise.all(
    raw.map(async (r) => ({
      title: r.title,
      dest: r.dest,
      pageIndex: await resolvePage(doc, r.dest),
      items: await build(doc, r.items ?? []),
    })),
  );
}

/** Document outline with page indices resolved; empty array when the PDF has no bookmarks. */
export function useOutline(doc: PDFDocumentProxy | null): { outline: OutlineNode[]; loaded: boolean } {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    setOutline([]);
    setLoaded(false);
    if (!doc) return;
    doc
      .getOutline()
      .then((raw) => build(doc, (raw ?? []) as unknown as RawOutlineItem[]))
      .then((nodes) => {
        if (!alive) return;
        setOutline(nodes);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [doc]);
  return { outline, loaded };
}

/** Deepest outline node whose page is <= the current page (for highlighting). */
export function activeOutlinePath(nodes: OutlineNode[], page: number): OutlineNode | null {
  let best: OutlineNode | null = null;
  const walk = (list: OutlineNode[]) => {
    for (const n of list) {
      if (n.pageIndex >= 0 && n.pageIndex <= page && (!best || n.pageIndex >= best.pageIndex)) best = n;
      walk(n.items);
    }
  };
  walk(nodes);
  return best;
}
