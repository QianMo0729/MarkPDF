import { execute, getDb, insertRow, select } from "../client";
import { notifyChanged } from "../live";
import type { TranscriptSegmentRow } from "../schema";
import { newId, nowIso } from "../../../core/utils/ids";

/** Rough script detection for the `lang` column (docs/SPEC.md 4.3). */
export function detectLang(text: string): "zh" | "en" | "mixed" {
  const cjk = /[\u3400-\u9fff]/.test(text);
  const latin = /[A-Za-z]{2,}/.test(text);
  return cjk && latin ? "mixed" : cjk ? "zh" : "en";
}

/** Stores one segment produced by the on-device engine (docs/SPEC.md 7.5). */
export async function insertDeviceSegment(sessionId: string, t0Ms: number, t1Ms: number, text: string, pageIndex: number | null): Promise<TranscriptSegmentRow> {
  const now = nowIso();
  const row: TranscriptSegmentRow = {
    id: newId(),
    session_id: sessionId,
    source: "device",
    t0_ms: Math.max(0, Math.floor(t0Ms)),
    t1_ms: Math.max(0, Math.floor(t1Ms)),
    text,
    translation: null,
    lang: detectLang(text),
    page_index: pageIndex,
    created_at: now,
    updated_at: now,
    dirty: 1,
  };
  await insertRow("transcript_segments", row as unknown as Record<string, unknown>);
  notifyChanged("transcript_segments");
  return row;
}

/**
 * Replace the on-device transcript of a session with a fresh offline decode
 * (docs/SPEC.md 16.1). Old rows go away together with their corrections and
 * translations; inserts are batched so a long lecture does not take hundreds of
 * round trips.
 */
export async function replaceDeviceSegments(
  sessionId: string,
  segments: { t0_ms: number; t1_ms: number; text: string; page_index: number | null }[],
): Promise<TranscriptSegmentRow[]> {
  const now = nowIso();
  const rows: TranscriptSegmentRow[] = segments.map((s) => ({
    id: newId(),
    session_id: sessionId,
    source: "device",
    t0_ms: Math.max(0, Math.floor(s.t0_ms)),
    t1_ms: Math.max(0, Math.floor(s.t1_ms)),
    text: s.text,
    translation: null,
    lang: detectLang(s.text),
    page_index: s.page_index,
    created_at: now,
    updated_at: now,
    dirty: 1,
  }));
  await execute("DELETE FROM transcript_segments WHERE session_id = ? AND source = 'device'", [sessionId]);
  const cols = ["id", "session_id", "source", "t0_ms", "t1_ms", "text", "translation", "lang", "page_index", "created_at", "updated_at", "dirty"] as const;
  const BATCH = 40;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const placeholders = chunk.map(() => `(${cols.map(() => "?").join(", ")})`).join(", ");
    await execute(`INSERT INTO transcript_segments (${cols.join(", ")}) VALUES ${placeholders}`, chunk.flatMap((r) => cols.map((c) => r[c])));
  }
  notifyChanged("transcript_segments");
  return rows;
}

export function listSegments(sessionId: string, source?: "device" | "server"): Promise<TranscriptSegmentRow[]> {
  return source
    ? select<TranscriptSegmentRow>("SELECT * FROM transcript_segments WHERE session_id = ? AND source = ? ORDER BY t0_ms", [sessionId, source])
    : select<TranscriptSegmentRow>("SELECT * FROM transcript_segments WHERE session_id = ? ORDER BY t0_ms", [sessionId]);
}

/** Save only to the unchanged sentence we translated, without overwriting another result. */
export async function saveSegmentTranslation(row: Pick<TranscriptSegmentRow, "id" | "session_id" | "text">, translation: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const text = translation.trim();
  if (!text) throw new Error("翻译结果为空");
  await execute(
    "UPDATE transcript_segments SET translation = ?, updated_at = ?, dirty = 1 WHERE id = ? AND session_id = ? AND text = ? AND (translation IS NULL OR trim(translation) = '')",
    [text, nowIso(), row.id, row.session_id, row.text],
  );
  notifyChanged("transcript_segments");
}

/** Apply only to the exact sentence reviewed; keep its first ASR wording forever. */
export async function saveSegmentCorrection(
  row: Pick<TranscriptSegmentRow, "id" | "session_id" | "text">,
  correctedText: string,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const text = correctedText.trim();
  if (!text) throw new Error("纠错结果为空");
  if (text === row.text) return;
  // One compare-and-swap statement avoids overwriting an edited sentence, a
  // different recording, or a newer correction that won the race. Reading the
  // affected-row count also avoids waking translation for a rejected stale result.
  const result = await getDb().execute(
    "UPDATE transcript_segments SET original_text = COALESCE(original_text, text), text = ?, translation = NULL, lang = ?, dirty = 1, updated_at = ? WHERE id = ? AND session_id = ? AND text = ?",
    [text, detectLang(text), nowIso(), row.id, row.session_id, row.text],
  );
  if (result.rowsAffected > 0) notifyChanged("transcript_segments");
}
