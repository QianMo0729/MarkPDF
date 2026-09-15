import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { TranscriptSegmentRow } from "../../../data/db/schema";
import { IDLE_TRANSCRIPT_CORRECTION, TranscriptCorrectionQueue } from "./transcriptCorrection";

export function useTranscriptCorrection(options: { enabled: boolean; sessionId: string | null; ready: boolean; rows: TranscriptSegmentRow[] }) {
  const { enabled, sessionId, ready, rows } = options;
  const [state, setState] = useState(IDLE_TRANSCRIPT_CORRECTION);
  const queue = useRef<TranscriptCorrectionQueue | null>(null);
  const latestRows = useRef(rows);
  latestRows.current = rows;
  useLayoutEffect(() => {
    setState(IDLE_TRANSCRIPT_CORRECTION);
    if (!enabled || !sessionId || !ready) return;
    const next = new TranscriptCorrectionQueue({ sessionId, onState: setState });
    queue.current = next;
    next.observe(latestRows.current);
    return () => { next.dispose(); if (queue.current === next) queue.current = null; };
  }, [enabled, sessionId, ready]);
  useLayoutEffect(() => { if (ready) queue.current?.observe(rows); }, [ready, rows]);
  const retry = useCallback(() => queue.current?.retry(), []);
  const stop = useCallback(() => { queue.current?.dispose(); queue.current = null; setState(IDLE_TRANSCRIPT_CORRECTION); }, []);
  return { ...state, retry, stop };
}
