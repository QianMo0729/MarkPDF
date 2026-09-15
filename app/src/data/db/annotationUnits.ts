import { execute, select } from "./client";
import { notifyChanged } from "./live";
import { getState, setState } from "./repos/syncState";
import type { AnnotationRow, EventRow } from "./schema";
import { CSS_PX_PER_PT } from "../../pdf/coords";

/**
 * One-time data repair (2026-09-15). Until this version the annotation layer
 * treated pdf.js's zoom value as "CSS pixels per point", but pdf.js draws a page
 * at `scale × 96/72` pixels per point. Coordinates were therefore stored in units
 * where a 960 pt page is 1280 wide: everything still lined up on screen (the same
 * wrong factor was used both ways), but the page bounds used real points, so a
 * text box could never be dragged past 75 % of the page, and the PDF export placed
 * every annotation at 75 % of its true position. Now that the layer uses real
 * points, existing rows and replay snapshots are scaled once by 72/96.
 */

const FLAG_KEY = "annotation_units";
const FLAG_VALUE = "pt";
export const LEGACY_TO_PT = 1 / CSS_PX_PER_PT;

function scaleJsonNumbers(json: string | null, k: number): string | null {
  if (!json) return json;
  try {
    const walk = (v: unknown): unknown => (typeof v === "number" ? Math.round(v * k * 100) / 100 : Array.isArray(v) ? v.map(walk) : v);
    return JSON.stringify(walk(JSON.parse(json) as unknown));
  } catch {
    return json;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The geometric fields of a row multiplied by `k` (pure; used by the migration and its tests). */
export function scaleAnnotationRow<T extends Pick<AnnotationRow, "x" | "y" | "w" | "h" | "quads_json" | "strokes_json" | "font_size">>(row: T, k: number): T {
  return {
    ...row,
    x: round2(row.x * k),
    y: round2(row.y * k),
    w: round2(row.w * k),
    h: round2(row.h * k),
    quads_json: scaleJsonNumbers(row.quads_json, k),
    strokes_json: scaleJsonNumbers(row.strokes_json, k),
    font_size: row.font_size === null ? null : round2(row.font_size * k),
  };
}

/** `annotation_snapshot` payload with its embedded row scaled (unknown shapes pass through). */
export function scaleSnapshotPayload(payloadJson: string, k: number): string {
  try {
    const payload = JSON.parse(payloadJson) as { annotation?: unknown };
    const a = payload.annotation;
    if (!a || typeof a !== "object" || typeof (a as AnnotationRow).x !== "number") return payloadJson;
    return JSON.stringify({ ...payload, annotation: scaleAnnotationRow(a as AnnotationRow, k) });
  } catch {
    return payloadJson;
  }
}

/** Runs once per database; later starts are a single sync_state read. */
export async function migrateAnnotationUnits(): Promise<void> {
  if ((await getState(FLAG_KEY)) === FLAG_VALUE) return;
  const rows = await select<AnnotationRow>("SELECT * FROM annotations");
  for (const r of rows) {
    const s = scaleAnnotationRow(r, LEGACY_TO_PT);
    await execute("UPDATE annotations SET x = ?, y = ?, w = ?, h = ?, quads_json = ?, strokes_json = ?, font_size = ? WHERE id = ?", [s.x, s.y, s.w, s.h, s.quads_json, s.strokes_json, s.font_size, r.id]);
  }
  const events = await select<Pick<EventRow, "id" | "payload_json">>("SELECT id, payload_json FROM events WHERE type = 'annotation_snapshot'");
  for (const e of events) {
    const next = scaleSnapshotPayload(e.payload_json, LEGACY_TO_PT);
    if (next !== e.payload_json) await execute("UPDATE events SET payload_json = ? WHERE id = ?", [next, e.id]);
  }
  await setState(FLAG_KEY, FLAG_VALUE);
  if (rows.length || events.length) notifyChanged("annotations", "events");
}
