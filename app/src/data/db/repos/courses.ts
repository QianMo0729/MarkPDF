import { execute, insertRow, select, selectOne, updateById } from "../client";
import { notifyChanged } from "../live";
import type { CourseRow } from "../schema";
import { newId, nowIso } from "../../../core/utils/ids";

export interface CourseSummary extends CourseRow {
  deck_count: number;
  session_count: number;
  last_activity: string | null;
}

const SUMMARY_SQL = `
  SELECT c.*,
    (SELECT COUNT(*) FROM decks d WHERE d.course_id = c.id AND d.deleted_at IS NULL) AS deck_count,
    (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id AND s.deleted_at IS NULL AND s.started_at IS NOT NULL) AS session_count,
    (SELECT MAX(x.updated_at) FROM (
        SELECT updated_at FROM decks WHERE course_id = c.id AND deleted_at IS NULL
        UNION ALL SELECT updated_at FROM sessions WHERE course_id = c.id AND deleted_at IS NULL
        UNION ALL SELECT c.updated_at) x) AS last_activity
  FROM courses c
  WHERE c.deleted_at IS NULL`;

export async function listCourses(search = ""): Promise<CourseSummary[]> {
  const q = search.trim();
  if (q) {
    return select<CourseSummary>(`${SUMMARY_SQL} AND c.name LIKE ? ORDER BY last_activity DESC`, [
      `%${q}%`,
    ]);
  }
  return select<CourseSummary>(`${SUMMARY_SQL} ORDER BY last_activity DESC`);
}

export async function getCourse(id: string): Promise<CourseRow | null> {
  return selectOne<CourseRow>("SELECT * FROM courses WHERE id = ? AND deleted_at IS NULL", [id]);
}

export async function createCourse(input: {
  name: string;
  term: string | null;
  colorIndex: number;
}): Promise<CourseRow> {
  const ts = nowIso();
  const row: CourseRow = {
    id: newId(),
    name: input.name.trim(),
    term: input.term?.trim() || null,
    color_index: input.colorIndex,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 1,
  };
  await insertRow("courses", row as unknown as Record<string, unknown>);
  notifyChanged("courses");
  return row;
}

export async function updateCourse(
  id: string,
  patch: { name?: string; term?: string | null; color_index?: number },
): Promise<void> {
  await updateById("courses", id, { ...patch, updated_at: nowIso(), dirty: 1 });
  notifyChanged("courses");
}

/** Soft delete the course and everything under it (decks, sessions). */
export async function deleteCourse(id: string): Promise<void> {
  const ts = nowIso();
  await execute("UPDATE courses SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?", [ts, ts, id]);
  await execute(
    "UPDATE decks SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE course_id = ? AND deleted_at IS NULL",
    [ts, ts, id],
  );
  await execute(
    "UPDATE sessions SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE course_id = ? AND deleted_at IS NULL",
    [ts, ts, id],
  );
  notifyChanged("courses", "decks", "sessions");
}

/** Course palette, index 0–7 (docs/SPEC.md 6.4.2). */
export const COURSE_COLORS = [
  "#4457D6",
  "#2FA36B",
  "#E5484D",
  "#F0803C",
  "#8E5BD6",
  "#1E9AB0",
  "#B5651D",
  "#5C6470",
] as const;
