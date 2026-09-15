import { useEffect, useMemo, useRef, useState } from "react";
import { subscribe } from "../../../data/db/live";
import { listEvents, listEventsSince } from "../../../data/db/repos/events";
import type { SessionRow } from "../../../data/db/schema";
import { eventFromRow, Timeline, type TimelineEvent } from "../../../domain/timeline";

interface Parsed {
  sessionId: string;
  events: TimelineEvent[];
}

/**
 * Timeline derived from a session's events (docs/SPEC.md 5.2). `liveMs` extends the
 * last interval while recording.
 *
 * Events are fetched once and then only the rows appended since the last fetch
 * (by `created_at`), and every row is JSON-parsed exactly once. A live tick therefore
 * only re-derives the cheap interval table over already-parsed events instead of
 * re-reading and re-parsing every note snapshot 10× per second (audit F7).
 */
export function useTimeline(session: SessionRow | null | undefined, liveMs?: number): Timeline | null {
  const sessionId = session?.id ?? null;
  const initialPageIndex = session?.initial_page_index ?? 0;
  const durationMs = session?.ended_at ? (session.duration_ms ?? 0) : (liveMs ?? 0);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const cache = useRef<{ sessionId: string; byId: Map<string, TimelineEvent>; lastCreated: string | null } | null>(null);

  useEffect(() => {
    if (!sessionId) {
      cache.current = null;
      setParsed(null);
      return;
    }
    let alive = true;
    let chain: Promise<void> = Promise.resolve();
    const load = () => {
      chain = chain.then(async () => {
        if (!alive) return;
        const c = cache.current?.sessionId === sessionId ? cache.current : (cache.current = { sessionId, byId: new Map(), lastCreated: null });
        const rows = c.lastCreated ? await listEventsSince(sessionId, c.lastCreated) : await listEvents(sessionId);
        if (!alive) return;
        let changed = false;
        for (const r of rows) {
          if (!c.byId.has(r.id)) {
            c.byId.set(r.id, eventFromRow(r));
            changed = true;
          }
          if (!c.lastCreated || r.created_at > c.lastCreated) c.lastCreated = r.created_at;
        }
        if (changed || !c.lastCreated) setParsed({ sessionId, events: [...c.byId.values()] });
        else setParsed((p) => p ?? { sessionId, events: [] });
      });
    };
    load();
    const unsubscribe = subscribe((table) => {
      if (table === "events") load();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [sessionId]);

  return useMemo(() => {
    if (!sessionId || !parsed || parsed.sessionId !== sessionId) return null;
    return new Timeline({ events: parsed.events, initialPageIndex, durationMs });
  }, [sessionId, parsed, initialPageIndex, durationMs]);
}
