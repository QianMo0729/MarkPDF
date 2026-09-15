import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { TranscriptSegmentRow } from "../../../data/db/schema";
import type { TranslationMode } from "../../../stores/settings";
import { IDLE_TRANSCRIPT_TRANSLATION, TranscriptTranslationQueue } from "./transcriptTranslation";

export function useTranscriptTranslation(options: {
  enabled: boolean;
  sessionId: string | null;
  ready: boolean;
  rows: TranscriptSegmentRow[];
  target: "zh" | "en";
  mode: TranslationMode;
}) {
  const { enabled, sessionId, ready, rows, target, mode } = options;
  const [state, setState] = useState(IDLE_TRANSCRIPT_TRANSLATION);
  const queue = useRef<TranscriptTranslationQueue | null>(null);
  const latestRows = useRef(rows);
  latestRows.current = rows;

  // Layout cleanup runs on a session/setting change before a late async answer can
  // be handled for the previous view. Each save also guards session, row and text.
  useLayoutEffect(() => {
    setState(IDLE_TRANSCRIPT_TRANSLATION);
    if (!enabled || !sessionId || !ready) return;
    const next = new TranscriptTranslationQueue({ sessionId, target, mode, onState: setState });
    queue.current = next;
    next.observe(latestRows.current);
    return () => { next.dispose(); if (queue.current === next) queue.current = null; };
  }, [enabled, sessionId, ready, target, mode]);

  useLayoutEffect(() => { if (ready) queue.current?.observe(rows); }, [rows, ready]);

  const retry = useCallback(() => queue.current?.retry(), []);
  const stop = useCallback(() => {
    queue.current?.dispose();
    queue.current = null;
    setState(IDLE_TRANSCRIPT_TRANSLATION);
  }, []);
  return { ...state, retry, stop };
}
