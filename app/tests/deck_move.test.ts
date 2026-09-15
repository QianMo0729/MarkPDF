// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));
vi.mock("../src/data/db/client", () => ({
  getDb: () => bridge, execute: bridge.execute, select: bridge.select,
  insertRow: vi.fn(), selectOne: vi.fn(), updateById: vi.fn(),
}));
import { listRecentDecks, moveDeckToCourse } from "../src/data/db/repos/decks";
let db: DatabaseSync;
const migration = (file: string) => readFileSync(new URL(`../src-tauri/migrations/${file}`, import.meta.url), "utf8");
function insert(table: string, values: Record<string, unknown>) {
  db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`)
    .run(...Object.values(values) as (string | number | null)[]);
}
const base = { created_at: "2026-09-15", updated_at: "2026-09-15" };
const get = (sql: string) => db.prepare(sql).get();
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(migration("0001_init.sql"));
  db.exec(migration("0002_mindmap.sql"));
  db.exec(migration("0003_text_box_style.sql"));
  for (const id of ["old", "new"]) insert("courses", { id, name: id, ...base });
  insert("decks", { id: "pdf", course_id: "old", title: "Lecture", source_type: "pdf", file_sha256: "same", status: "ready", local_pdf_path: "decks/pdf.pdf", ...base });
  insert("sessions", { id: "audio", deck_id: "pdf", course_id: "old", title: "Audio", started_at: "2026-09-15", local_wav_path: "sessions/audio.wav", ...base });
  insert("notes", { id: "note", deck_id: "pdf", page_index: 0, markdown: "my note", ...base });
  insert("transcript_segments", { id: "transcript", session_id: "audio", source: "device", t0_ms: 0, t1_ms: 2000, text: "hello", ...base });
  db.exec(migration("0004_deck_recordings.sql"));
  bridge.execute.mockImplementation(async (sql: string, args: (string | number)[]) => ({ rowsAffected: Number(db.prepare(sql).run(...args).changes) }));
  bridge.select.mockImplementation(async (sql: string, args: (string | number)[]) => db.prepare(sql).all(...args));
});
afterEach(() => db.close());

describe("atomic PDF transfer on the real SQLite schema", () => {
  it("moves old and active recordings without changing IDs, files, notes or transcripts", async () => {
    const originalNote = get("SELECT * FROM notes");
    const originalTranscript = get("SELECT * FROM transcript_segments");
    await moveDeckToCourse("pdf", "new");
    expect(get("SELECT course_id, local_pdf_path FROM decks")).toMatchObject({ course_id: "new", local_pdf_path: "decks/pdf.pdf" });
    expect(get("SELECT id, deck_id, course_id, local_wav_path FROM sessions")).toMatchObject({ id: "audio", deck_id: "pdf", course_id: "new", local_wav_path: "sessions/audio.wav" });
    expect(get("SELECT * FROM notes")).toEqual(originalNote);
    expect(get("SELECT * FROM transcript_segments")).toEqual(originalTranscript);
    expect(get("SELECT COUNT(*) AS n FROM sessions WHERE course_id = 'old'")).toMatchObject({ n: 0 });
  });
  it("rejects missing/deleted targets and importing decks without partial movement", async () => {
    await expect(moveDeckToCourse("pdf", "missing")).rejects.toThrow("无法移动");
    db.exec("UPDATE courses SET deleted_at = 'today' WHERE id = 'new'");
    await expect(moveDeckToCourse("pdf", "new")).rejects.toThrow();
    db.exec("UPDATE courses SET deleted_at = NULL; UPDATE decks SET status = 'importing'");
    await expect(moveDeckToCourse("pdf", "new")).rejects.toThrow();
    expect(get("SELECT course_id FROM decks")).toMatchObject({ course_id: "old" });
    expect(get("SELECT course_id FROM sessions")).toMatchObject({ course_id: "old" });
  });
  it("inherits the PDF course even if a recording insert races with a move", async () => {
    await moveDeckToCourse("pdf", "new");
    insert("sessions", { id: "new-audio", deck_id: "pdf", course_id: "old", title: "New", ...base });
    expect(get("SELECT course_id FROM sessions WHERE id = 'new-audio'")).toMatchObject({ course_id: "new" });
  });
  it("groups recent activity by PDF and counts recordings once", async () => {
    insert("sessions", { id: "empty", deck_id: "pdf", course_id: "old", title: "Preparation", ...base });
    const recent = await listRecentDecks();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ id: "pdf", recording_count: 1, course_name: "old" });
  });
  it("repairs existing course mismatches without dropping data", () => {
    db.exec("UPDATE sessions SET course_id = 'new'");
    db.exec(migration("0004_deck_recordings.sql"));
    expect(get("SELECT course_id, local_wav_path FROM sessions")).toMatchObject({ course_id: "old", local_wav_path: "sessions/audio.wav" });
  });
});
