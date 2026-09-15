import { useEffect, useMemo, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { S } from "../../../core/strings";
import { Icon } from "../../../core/ui/Icon";
import { select } from "../../../data/db/client";
import { useSessionUi, useViewerState } from "../sessionStore";
import "./panels.css";

type Scope = "deck" | "notes" | "annotations" | "transcript";

interface Hit {
  scope: Scope;
  pageIndex: number;
  before: string;
  match: string;
  after: string;
  /** For notes / annotations: which panel to open. */
  annotationId?: string;
}

const CONTEXT = 40;

function extractHits(scope: Scope, pageIndex: number, text: string, query: string, annotationId?: string): Hit[] {
  const hits: Hit[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let from = 0;
  while (hits.length < 20) {
    const i = lower.indexOf(q, from);
    if (i < 0) break;
    hits.push({
      scope,
      pageIndex,
      before: text.slice(Math.max(0, i - CONTEXT), i).replace(/\s+/g, " "),
      match: text.slice(i, i + query.length),
      after: text.slice(i + query.length, i + query.length + CONTEXT).replace(/\s+/g, " "),
      annotationId,
    });
    from = i + query.length;
  }
  return hits;
}

async function searchAll(deckId: string, query: string, scopes: Set<Scope>): Promise<Hit[]> {
  const like = `%${query}%`;
  const out: Hit[] = [];
  if (scopes.has("deck")) {
    const rows = await select<{ page_index: number; text: string }>(
      "SELECT page_index, text FROM deck_pages WHERE deck_id = ? AND text LIKE ? ORDER BY page_index",
      [deckId, like],
    );
    for (const r of rows) out.push(...extractHits("deck", r.page_index, r.text, query));
  }
  if (scopes.has("notes")) {
    const rows = await select<{ page_index: number; markdown: string }>(
      "SELECT page_index, markdown FROM notes WHERE deck_id = ? AND markdown LIKE ? ORDER BY page_index",
      [deckId, like],
    );
    for (const r of rows) out.push(...extractHits("notes", r.page_index, r.markdown, query));
  }
  if (scopes.has("annotations")) {
    const rows = await select<{ id: string; page_index: number; markdown: string | null; selected_text: string | null }>(
      "SELECT id, page_index, markdown, selected_text FROM annotations WHERE deck_id = ? AND deleted_at IS NULL AND (markdown LIKE ? OR selected_text LIKE ?) ORDER BY page_index",
      [deckId, like, like],
    );
    for (const r of rows) {
      const text = [r.selected_text, r.markdown].filter(Boolean).join("  ");
      out.push(...extractHits("annotations", r.page_index, text, query, r.id));
    }
  }
  return out;
}

const SCOPE_LABELS: Record<Scope, string> = { deck: "课件", notes: "笔记", annotations: "标注", transcript: "转写" };

/** Search across deck text, notes, annotations (transcript arrives with M7) — docs/SPEC.md 6.5.9. */
export function SearchPanel(props: IDockviewPanelProps) {
  const deckId = useSessionUi((s) => s.deckId);
  const controller = useSessionUi((s) => s.controller);
  const focusRequest = useSessionUi((s) => s.focusRequest);
  const state = useViewerState();
  const [query, setQuery] = useState("");
  const [scopes, setScopes] = useState<Set<Scope>>(new Set(["deck", "notes", "annotations"]));
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQuery = useRef("");

  useEffect(() => {
    if (focusRequest?.panel === "search") {
      props.api.setActive();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusRequest, props.api]);

  useEffect(() => {
    const q = query.trim();
    if (!deckId || q.length === 0) {
      setHits([]);
      if (lastQuery.current) controller?.clearFind();
      lastQuery.current = "";
      return;
    }
    const t = window.setTimeout(() => {
      setSearching(true);
      searchAll(deckId, q, scopes)
        .then(setHits)
        .finally(() => setSearching(false));
      controller?.find({ query: q });
      lastQuery.current = q;
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, scopes, deckId, controller]);

  const grouped = useMemo(() => {
    const map = new Map<Scope, Hit[]>();
    for (const h of hits) map.set(h.scope, [...(map.get(h.scope) ?? []), h]);
    return map;
  }, [hits]);

  const toggleScope = (s: Scope) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && query.trim()) {
      controller?.find({ query: query.trim(), again: true, previous: e.shiftKey });
      e.preventDefault();
    }
    e.stopPropagation();
  };

  const go = (h: Hit) => {
    controller?.goToPage(h.pageIndex);
    if (h.scope === "deck" && query.trim()) controller?.find({ query: query.trim() });
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="input panel-search">
          <Icon name="search" size={18} className="text3" />
          <input ref={inputRef} placeholder="搜索课件、笔记、标注" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} aria-label={S.tools.search} />
          {query && (
            <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="清空" onClick={() => setQuery("")}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 6, padding: "0 12px 8px", flexWrap: "wrap" }}>
        {(["deck", "notes", "annotations", "transcript"] as Scope[]).map((s) => (
          <button
            key={s}
            className={`chip ${scopes.has(s) ? "selected" : ""}`}
            disabled={s === "transcript"}
            onClick={() => toggleScope(s)}
            aria-pressed={scopes.has(s)}
          >
            {SCOPE_LABELS[s]}
          </button>
        ))}
        {state.findTotal > 0 && query.trim() && (
          <span className="caption tabular" style={{ marginLeft: "auto" }}>
            {state.findCurrent} / {state.findTotal}
          </span>
        )}
      </div>
      <div className="panel-body scroll-y">
        {query.trim() && !searching && hits.length === 0 && <div className="caption" style={{ padding: 12 }}>没有找到“{query.trim()}”</div>}
        {[...grouped.entries()].map(([scope, list]) => (
          <div key={scope}>
            <div className="caption panel-group-title">
              {SCOPE_LABELS[scope]}  {list.length} 处
            </div>
            {list.map((h, i) => (
              <button key={i} className="search-hit" onClick={() => go(h)}>
                <span className="caption tabular">第 {h.pageIndex + 1} 页</span>
                <span className="body-small search-hit-text">
                  {h.before}
                  <mark>{h.match}</mark>
                  {h.after}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
