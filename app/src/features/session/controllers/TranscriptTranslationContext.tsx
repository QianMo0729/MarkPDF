import { createContext, useContext, useMemo, type ReactNode } from "react";
import { select } from "../../../data/db/client";
import { useLiveQuery } from "../../../data/db/live";
import type { TranscriptSegmentRow } from "../../../data/db/schema";
import { useSettings } from "../../../stores/settings";
import { useTranscriptTranslation } from "./useTranscriptTranslation";
import { useTranscriptCorrection } from "./useTranscriptCorrection";

interface TranscriptTranslationContextValue {
  sessionId: string | null;
  ready: boolean;
  rows: TranscriptSegmentRow[];
  translation: ReturnType<typeof useTranscriptTranslation>;
  correction: ReturnType<typeof useTranscriptCorrection>;
}

const Context = createContext<TranscriptTranslationContextValue | null>(null);
export const useSharedTranscriptTranslation = () => useContext(Context);

/** Owned by the PDF screen, so changing/rebuilding dock panels cannot drop queued speech. */
export function TranscriptTranslationProvider({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const enabled = useSettings((s) => s.settings.transcriptTranslationEnabled);
  const correctionEnabled = useSettings((s) => s.settings.transcriptCorrectionEnabled);
  const target = useSettings((s) => s.settings.translateTarget);
  const mode = useSettings((s) => s.settings.translationMode);
  const segments = useLiveQuery(async () => ({
    sessionId,
    rows: sessionId ? await select<TranscriptSegmentRow>(
      "SELECT * FROM transcript_segments WHERE session_id = ? AND source = (SELECT CASE WHEN EXISTS(SELECT 1 FROM transcript_segments WHERE session_id = ? AND source = 'server') THEN 'server' ELSE 'device' END) ORDER BY t0_ms",
      [sessionId, sessionId],
    ) : [],
  }), ["transcript_segments"], [sessionId]);
  const ready = segments.data?.sessionId === sessionId;
  const rows = useMemo(() => ready ? (segments.data?.rows ?? []).filter((row) => row.session_id === sessionId) : [], [segments.data, sessionId, ready]);
  const translation = useTranscriptTranslation({ enabled: !!enabled, sessionId, ready, rows, target, mode });
  const correction = useTranscriptCorrection({ enabled: !!correctionEnabled, sessionId, ready, rows });
  return <Context.Provider value={{ sessionId, ready, rows, translation, correction }}>{children}</Context.Provider>;
}
