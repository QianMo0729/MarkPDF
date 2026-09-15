import { fmtClock, fmtDateShort, fmtDuration } from "../core/utils/time";
import { select } from "../data/db/client";
import { listAnnotations } from "../data/db/repos/annotations";
import { getCourse } from "../data/db/repos/courses";
import { getDeck } from "../data/db/repos/decks";
import { listEvents } from "../data/db/repos/events";
import { listNodes } from "../data/db/repos/mindmap";
import { listNotesForDeck } from "../data/db/repos/notes";
import { getSession } from "../data/db/repos/sessions";
import type { AnnotationRow, MindmapNodeRow, TranscriptSegmentRow } from "../data/db/schema";
import { parseStrokes } from "../features/session/controllers/annotations";
import { eventFromRow, Timeline } from "./timeline";

/** Markdown export (docs/SPEC.md 11.6). Summaries are added once the backend exists. */

const oneLine = (s: string) => s.trim().replace(/\n+/g, " ");

function annotationLine(r: AnnotationRow): string {
  if (r.kind === "highlight") return `- 高亮“${(r.selected_text ?? "").trim()}”${r.markdown?.trim() ? `  备注：${oneLine(r.markdown)}` : ""}`;
  if (r.kind === "text_box") return `- 文本框：${oneLine(r.markdown ?? "")}`;
  return `- 墨迹（${parseStrokes(r).length} 笔）`;
}

/** Mind map as an indented outline (docs/SPEC.md 6.5.19). */
async function mindmapOutline(deckId: string, annotations: AnnotationRow[]): Promise<string[]> {
  const nodes = await listNodes(deckId);
  if (nodes.length <= 1) return [];
  const byAnn = new Map(annotations.map((a) => [a.id, a]));
  const children = new Map<string | null, MindmapNodeRow[]>();
  for (const n of nodes) children.set(n.parent_id, [...(children.get(n.parent_id) ?? []), n]);
  const lines: string[] = ["## 导图", ""];
  const walk = (parent: string | null, depth: number) => {
    for (const n of (children.get(parent) ?? []).sort((a, b) => a.order_index - b.order_index)) {
      const a = n.annotation_id ? byAnn.get(n.annotation_id) : undefined;
      const excerpt = a ? ((a.kind === "highlight" ? a.selected_text : a.markdown) ?? "") : "";
      const label = [excerpt ? `“${oneLine(excerpt)}”` : "", oneLine(n.markdown)].filter(Boolean).join("  ");
      const page = n.page_index !== null ? `（第 ${n.page_index + 1} 页）` : "";
      lines.push(`${"  ".repeat(depth)}- ${label || "（空）"}${page}`);
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  lines.push("");
  return lines;
}

function stripTimestampChips(md: string): string {
  return md.replace(/\[((\d{1,2}:)?\d{1,2}:\d{2})\]/g, "`$1`");
}

export async function exportDeckMarkdown(deckId: string): Promise<string> {
  const deck = await getDeck(deckId);
  if (!deck) throw new Error("课件不存在");
  const notes = await listNotesForDeck(deckId);
  const annotations = await listAnnotations(deckId);
  const pages = new Set<number>([...notes.map((n) => n.page_index), ...annotations.map((a) => a.page_index)]);
  const out: string[] = [`# ${deck.title}`, ""];
  for (const p of [...pages].sort((a, b) => a - b)) {
    out.push(`## 第 ${p + 1} 页`, "");
    const note = notes.find((n) => n.page_index === p)?.markdown?.trim();
    if (note) out.push("### 笔记", "", stripTimestampChips(note), "");
    const anns = annotations.filter((a) => a.page_index === p);
    if (anns.length) out.push("### 标注", "", ...anns.map(annotationLine), "");
  }
  out.push(...(await mindmapOutline(deckId, annotations)));
  return out.join("\n");
}

export async function exportSessionMarkdown(sessionId: string): Promise<string> {
  const session = await getSession(sessionId);
  if (!session) throw new Error("会话不存在");
  const course = await getCourse(session.course_id);
  const notes = await listNotesForDeck(session.deck_id);
  const annotations = await listAnnotations(session.deck_id);
  const events = await listEvents(sessionId);
  const timeline = new Timeline({ events: events.map(eventFromRow), initialPageIndex: session.initial_page_index, durationMs: session.duration_ms ?? 0 });
  const transcript = await select<TranscriptSegmentRow>(
    "SELECT * FROM transcript_segments WHERE session_id = ? AND source = (SELECT CASE WHEN EXISTS(SELECT 1 FROM transcript_segments WHERE session_id = ? AND source = 'server') THEN 'server' ELSE 'device' END) ORDER BY t0_ms",
    [sessionId, sessionId],
  );

  const out: string[] = [`# ${session.title}`, `${course?.name ?? ""}  ${fmtDateShort(session.started_at ?? session.created_at)}  ${fmtDuration(session.duration_ms ?? 0)}`, ""];
  const talked = timeline.intervals.map((iv) => iv.pageIndex);
  const pages = new Set<number>([...talked, ...notes.map((n) => n.page_index), ...annotations.map((a) => a.page_index)]);
  for (const p of [...pages].sort((a, b) => a - b)) {
    out.push(`## 第 ${p + 1} 页`, "");
    const note = notes.find((n) => n.page_index === p)?.markdown?.trim();
    if (note) out.push("### 笔记", "", stripTimestampChips(note), "");
    const anns = annotations.filter((a) => a.page_index === p);
    if (anns.length) out.push("### 标注", "", ...anns.map(annotationLine), "");
    const segs = transcript.filter((s) => timeline.pageForSegment(s.t0_ms, s.t1_ms) === p);
    if (segs.length) out.push("### 转写", "", ...segs.map((s) => `\`${fmtClock(s.t0_ms)}\` ${s.text}${s.translation ? `\n  ${s.translation}` : ""}`), "");
  }
  if (timeline.markers.length) {
    out.push("## 标记", "", ...timeline.markers.map((m) => `- \`${fmtClock(m.tMs)}\` 第 ${m.pageIndex + 1} 页  ${m.kind === "important" ? "重点" : m.kind === "confused" ? "没听懂" : "作业"}`), "");
  }
  out.push(...(await mindmapOutline(session.deck_id, annotations)));
  return out.join("\n");
}
