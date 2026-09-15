import { describe, expect, it } from "vitest";
import { LEGACY_TO_PT, scaleAnnotationRow, scaleSnapshotPayload } from "../src/data/db/annotationUnits";
import { CSS_PX_PER_PT } from "../src/pdf/coords";

describe("annotation unit repair", () => {
  it("converts legacy zoom units to points (a box parked at the old 75% wall reaches the page edge)", () => {
    // 960 pt page; the box's right edge was clamped to 960 legacy units = 720 pt.
    const row = { x: 691.68, y: 219.2, w: 268.32, h: 40, quads_json: null, strokes_json: "[[[0,0],[1280,720]]]", font_size: 18 };
    const s = scaleAnnotationRow(row, LEGACY_TO_PT);
    expect(s.x + s.w).toBeCloseTo(720, 1);
    expect(s.font_size).toBe(13.5);
    expect(JSON.parse(s.strokes_json as string)).toEqual([[[0, 0], [960, 540]]]);
    expect(CSS_PX_PER_PT).toBeCloseTo(4 / 3, 6);
  });

  it("scales the row embedded in a replay snapshot and leaves other payloads alone", () => {
    const payload = JSON.stringify({ annotation_id: "a", op: "updated", annotation: { x: 100, y: 200, w: 40, h: 20, quads_json: "[[0,0,10,0,0,10,10,10]]", strokes_json: null, font_size: null } });
    const out = JSON.parse(scaleSnapshotPayload(payload, 0.5)) as { annotation: { x: number; quads_json: string } };
    expect(out.annotation.x).toBe(50);
    expect(JSON.parse(out.annotation.quads_json)).toEqual([[0, 0, 5, 0, 0, 5, 5, 5]]);
    const deleted = JSON.stringify({ annotation_id: "a", op: "deleted", annotation: null });
    expect(scaleSnapshotPayload(deleted, 0.5)).toBe(deleted);
  });
});
