import { useCallback, useEffect, useRef, useState } from "react";

/** Tables whose changes UI queries may subscribe to. */
export type Table =
  | "courses"
  | "decks"
  | "deck_pages"
  | "sessions"
  | "notes"
  | "annotations"
  | "transcript_segments"
  | "page_summaries"
  | "session_summaries"
  | "events"
  | "sync_state"
  | "asr_models"
  | "mindmap_nodes";

type Listener = (table: Table) => void;
const listeners = new Set<Listener>();

/** Repos call this after any write so live queries refetch. */
export function notifyChanged(...tables: Table[]): void {
  for (const t of tables) for (const l of listeners) l(t);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface LiveResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Runs `query` on mount and again whenever one of `tables` changes or `deps` change.
 * Poor man's drift.watch(): good enough for a single-process desktop app.
 */
export function useLiveQuery<T>(
  query: () => Promise<T>,
  tables: Table[],
  deps: unknown[] = [],
): LiveResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const tableKey = tables.join(",");

  const run = useCallback(() => {
    const my = ++seq.current;
    queryRef
      .current()
      .then((d) => {
        if (my !== seq.current) return;
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (my !== seq.current) return;
        setError(String(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  useEffect(() => {
    const wanted = new Set(tableKey.split(",").filter(Boolean) as Table[]);
    return subscribe((t) => {
      if (wanted.has(t)) run();
    });
  }, [tableKey, run]);

  return { data, loading, error, reload: run };
}
