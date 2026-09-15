import type { AnnotationRow, EventRow, EventType } from "../data/db/schema";

/**
 * Timeline semantics (docs/SPEC.md 5.2). Pure TypeScript, mirrored by
 * server/app/services/timeline.py; both must pass test/fixtures/timeline_cases.json.
 */

export interface TimelineEvent {
  id: string;
  type: EventType;
  t_ms: number;
  payload: Record<string, unknown>;
}

export interface PageInterval {
  pageIndex: number;
  t0Ms: number;
  t1Ms: number;
}

export interface NoteSnapshot {
  id: string;
  pageIndex: number;
  tMs: number;
  markdown: string;
}

export type MarkerKind = "important" | "confused" | "homework";

export interface Marker {
  id: string;
  tMs: number;
  kind: MarkerKind;
  pageIndex: number;
}

export interface AnnotationState {
  id: string;
  tMs: number;
  annotation: AnnotationRow;
}

export function eventFromRow(row: EventRow): TimelineEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { id: row.id, type: row.type, t_ms: row.t_ms, payload };
}

function byTimeThenId(a: TimelineEvent, b: TimelineEvent): number {
  return a.t_ms - b.t_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export class Timeline {
  readonly intervals: PageInterval[];
  readonly markers: Marker[];
  readonly durationMs: number;
  private readonly noteSnapshots = new Map<number, NoteSnapshot[]>();
  private readonly annotationEvents = new Map<number, TimelineEvent[]>();

  constructor(args: { events: TimelineEvent[]; initialPageIndex: number; durationMs: number }) {
    const events = [...args.events].sort(byTimeThenId);
    this.durationMs = Math.max(0, args.durationMs);

    // ----- page intervals -----
    const cuts: { tMs: number; page: number }[] = [{ tMs: 0, page: args.initialPageIndex }];
    for (const e of events) {
      if (e.type !== "page_change") continue;
      const page = Number(e.payload.page_index);
      if (!Number.isFinite(page)) continue;
      cuts.push({ tMs: Math.min(Math.max(0, e.t_ms), this.durationMs), page });
    }
    const intervals: PageInterval[] = [];
    for (let i = 0; i < cuts.length; i++) {
      const t0 = cuts[i].tMs;
      const t1 = i + 1 < cuts.length ? cuts[i + 1].tMs : this.durationMs;
      const page = cuts[i].page;
      const last = intervals[intervals.length - 1];
      if (last && last.pageIndex === page) {
        last.t1Ms = Math.max(last.t1Ms, t1);
      } else if (last && t1 <= t0 && i + 1 < cuts.length) {
        // zero-length cut immediately overridden by the next one: skip
        continue;
      } else {
        intervals.push({ pageIndex: page, t0Ms: t0, t1Ms: Math.max(t0, t1) });
      }
    }
    // Drop zero-length intervals except when they are the only one.
    this.intervals = intervals.length > 1 ? intervals.filter((iv, i) => iv.t1Ms > iv.t0Ms || i === intervals.length - 1) : intervals;
    if (this.intervals.length > 1) {
      const last = this.intervals[this.intervals.length - 1];
      if (last.t1Ms === last.t0Ms) this.intervals.pop();
    }
    // Ensure coverage [0, duration] with no gaps.
    for (let i = 1; i < this.intervals.length; i++) this.intervals[i].t0Ms = this.intervals[i - 1].t1Ms;
    if (this.intervals.length) {
      this.intervals[0].t0Ms = 0;
      this.intervals[this.intervals.length - 1].t1Ms = this.durationMs;
    }

    // ----- markers -----
    this.markers = events
      .filter((e) => e.type === "marker")
      .map((e) => ({ id: e.id, tMs: e.t_ms, kind: String(e.payload.kind) as MarkerKind, pageIndex: this.pageAt(e.t_ms) }));

    // ----- note snapshots per page -----
    for (const e of events) {
      if (e.type === "note_snapshot") {
        const page = Number(e.payload.page_index);
        if (!Number.isFinite(page)) continue;
        const list = this.noteSnapshots.get(page) ?? [];
        list.push({ id: e.id, pageIndex: page, tMs: e.t_ms, markdown: String(e.payload.markdown ?? "") });
        this.noteSnapshots.set(page, list);
      } else if (e.type === "annotation_snapshot") {
        const page = Number(e.payload.page_index);
        if (!Number.isFinite(page)) continue;
        const list = this.annotationEvents.get(page) ?? [];
        list.push(e);
        this.annotationEvents.set(page, list);
      }
    }
  }

  /** Binary search over intervals. */
  pageAt(tMs: number): number {
    const ivs = this.intervals;
    if (!ivs.length) return 0;
    if (tMs <= 0) return ivs[0].pageIndex;
    let lo = 0;
    let hi = ivs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ivs[mid].t0Ms <= tMs) lo = mid;
      else hi = mid - 1;
    }
    return ivs[lo].pageIndex;
  }

  intervalAt(tMs: number): PageInterval | null {
    const ivs = this.intervals;
    if (!ivs.length) return null;
    let lo = 0;
    let hi = ivs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ivs[mid].t0Ms <= tMs) lo = mid;
      else hi = mid - 1;
    }
    return ivs[lo];
  }

  /** Last snapshot of the page with t_ms <= tMs. */
  noteAt(pageIndex: number, tMs: number): NoteSnapshot | null {
    const list = this.noteSnapshots.get(pageIndex);
    if (!list) return null;
    let found: NoteSnapshot | null = null;
    for (const s of list) {
      if (s.tMs <= tMs) found = s;
      else break;
    }
    return found;
  }

  previousSnapshot(s: NoteSnapshot): NoteSnapshot | null {
    const list = this.noteSnapshots.get(s.pageIndex) ?? [];
    const i = list.findIndex((x) => x.id === s.id);
    return i > 0 ? list[i - 1] : null;
  }

  nextSnapshot(s: NoteSnapshot): NoteSnapshot | null {
    const list = this.noteSnapshots.get(s.pageIndex) ?? [];
    const i = list.findIndex((x) => x.id === s.id);
    return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
  }

  snapshotsFor(pageIndex: number): NoteSnapshot[] {
    return this.noteSnapshots.get(pageIndex) ?? [];
  }

  allNoteSnapshots(): NoteSnapshot[] {
    return [...this.noteSnapshots.values()].flat().sort((a, b) => a.tMs - b.tMs);
  }

  /** Annotations alive on the page at tMs, replaying created/updated/deleted ops (docs/SPEC.md 5.2). */
  annotationsAt(pageIndex: number, tMs: number): AnnotationState[] {
    const list = this.annotationEvents.get(pageIndex) ?? [];
    const alive = new Map<string, AnnotationState>();
    for (const e of list) {
      if (e.t_ms > tMs) break;
      const id = String(e.payload.annotation_id);
      const op = String(e.payload.op);
      if (op === "deleted") alive.delete(id);
      else if (e.payload.annotation && typeof e.payload.annotation === "object") {
        alive.set(id, { id, tMs: e.t_ms, annotation: e.payload.annotation as AnnotationRow });
      }
    }
    return [...alive.values()];
  }

  /** Alive annotations on every page at tMs (replay "当时的标注" across the deck). */
  annotationsAtAll(tMs: number): AnnotationRow[] {
    const out: AnnotationRow[] = [];
    for (const page of this.annotationEvents.keys()) for (const s of this.annotationsAt(page, tMs)) out.push(s.annotation);
    return out;
  }

  annotationCreationTimes(): number[] {
    const out: number[] = [];
    for (const list of this.annotationEvents.values()) for (const e of list) if (e.payload.op === "created") out.push(e.t_ms);
    return out.sort((a, b) => a - b);
  }

  /** Midpoint rule. */
  pageForSegment(t0Ms: number, t1Ms: number): number {
    return this.pageAt(Math.floor((t0Ms + t1Ms) / 2));
  }

  /** Next marker of a kind strictly after afterMs, wrapping around. */
  nextMarker(afterMs: number, kind: MarkerKind): Marker | null {
    const list = this.markers.filter((m) => m.kind === kind);
    if (!list.length) return null;
    return list.find((m) => m.tMs > afterMs) ?? list[0];
  }
}
