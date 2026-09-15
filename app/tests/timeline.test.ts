import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnnotationRow } from "../src/data/db/schema";
import { Timeline, type TimelineEvent } from "../src/domain/timeline";

interface Case {
  name: string;
  initial_page_index: number;
  duration_ms: number;
  events: TimelineEvent[];
  expect_intervals: { page_index: number; t0_ms: number; t1_ms: number }[];
  page_at?: [number, number][];
  segment_pages?: [number, number, number][];
}

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../test/fixtures/timeline_cases.json"), "utf8")) as { cases: Case[] };

describe("Timeline (shared fixtures)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const tl = new Timeline({ events: c.events, initialPageIndex: c.initial_page_index, durationMs: c.duration_ms });
      expect(tl.intervals.map((iv) => ({ page_index: iv.pageIndex, t0_ms: iv.t0Ms, t1_ms: iv.t1Ms }))).toEqual(c.expect_intervals);
      for (const [t, page] of c.page_at ?? []) expect(tl.pageAt(t)).toBe(page);
      for (const [t0, t1, page] of c.segment_pages ?? []) expect(tl.pageForSegment(t0, t1)).toBe(page);
    });
  }
});

describe("Timeline notes, markers and annotations", () => {
  const ann = (id: string, md: string): AnnotationRow =>
    ({ id, deck_id: "d", page_index: 1, kind: "text_box", x: 0, y: 0, w: 10, h: 10, color: "#000", markdown: md, selected_text: null, quads_json: null, strokes_json: null, stroke_width: null, font_size: 11, z: 1, created_at: "", updated_at: "", deleted_at: null, dirty: 0 }) as AnnotationRow;
  const events: TimelineEvent[] = [
    { id: "e1", type: "page_change", t_ms: 10000, payload: { page_index: 1 } },
    { id: "n1", type: "note_snapshot", t_ms: 12000, payload: { page_index: 1, markdown: "a" } },
    { id: "n2", type: "note_snapshot", t_ms: 20000, payload: { page_index: 1, markdown: "a\nb" } },
    { id: "m1", type: "marker", t_ms: 15000, payload: { kind: "confused" } },
    { id: "m2", type: "marker", t_ms: 25000, payload: { kind: "important" } },
    { id: "a1", type: "annotation_snapshot", t_ms: 13000, payload: { annotation_id: "x", page_index: 1, kind: "text_box", op: "created", annotation: ann("x", "v1") } },
    { id: "a2", type: "annotation_snapshot", t_ms: 18000, payload: { annotation_id: "x", page_index: 1, kind: "text_box", op: "updated", annotation: ann("x", "v2") } },
    { id: "a3", type: "annotation_snapshot", t_ms: 22000, payload: { annotation_id: "x", page_index: 1, kind: "text_box", op: "deleted", annotation: null } },
  ];
  const tl = new Timeline({ events, initialPageIndex: 0, durationMs: 30000 });

  it("noteAt returns the latest snapshot at or before t", () => {
    expect(tl.noteAt(1, 11000)).toBeNull();
    expect(tl.noteAt(1, 12000)?.markdown).toBe("a");
    expect(tl.noteAt(1, 25000)?.markdown).toBe("a\nb");
    expect(tl.previousSnapshot(tl.noteAt(1, 25000)!)?.markdown).toBe("a");
  });
  it("markers carry their page and nextMarker wraps", () => {
    expect(tl.markers.map((m) => m.pageIndex)).toEqual([1, 1]);
    expect(tl.nextMarker(16000, "confused")?.id).toBe("m1");
    expect(tl.nextMarker(0, "important")?.id).toBe("m2");
    expect(tl.nextMarker(0, "homework")).toBeNull();
  });
  it("annotationsAt replays created / updated / deleted", () => {
    expect(tl.annotationsAt(1, 12999)).toEqual([]);
    expect(tl.annotationsAt(1, 13000)[0].annotation.markdown).toBe("v1");
    expect(tl.annotationsAt(1, 18000)[0].annotation.markdown).toBe("v2");
    expect(tl.annotationsAt(1, 22000)).toEqual([]);
  });
});
