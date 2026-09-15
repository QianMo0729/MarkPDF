import { wikiLinks, type WikiLinkSuggestion } from "@atomic-editor/editor";
import type { Extension } from "@codemirror/state";

/** `[[p7]]` links to page 7 of the current deck (docs/SPEC.md 6.5.7 rule 9). */

const PAGE_RE = /^p(\d+)$/i;

export function pageLinkTarget(target: string): number | null {
  const m = PAGE_RE.exec(target.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? n - 1 : null;
}

export function pageLinks(opts: { pageCount: () => number; onOpen: (page0: number) => void }): Extension {
  return wikiLinks({
    resolve: async (target) => {
      const page0 = pageLinkTarget(target);
      if (page0 === null) return { target, label: target, status: "missing" };
      const ok = page0 < opts.pageCount();
      return { target, label: `第 ${page0 + 1} 页`, status: ok ? "resolved" : "missing" };
    },
    suggest: async (query) => {
      const n = opts.pageCount();
      const q = query.trim().toLowerCase().replace(/^p/, "");
      const out: WikiLinkSuggestion[] = [];
      for (let i = 1; i <= n && out.length < 12; i++) {
        if (!q || String(i).startsWith(q)) out.push({ target: `p${i}`, label: `第 ${i} 页` });
      }
      return out;
    },
    onOpen: (target) => {
      const page0 = pageLinkTarget(target);
      if (page0 !== null) opts.onOpen(page0);
    },
    openOnClick: true,
  });
}
