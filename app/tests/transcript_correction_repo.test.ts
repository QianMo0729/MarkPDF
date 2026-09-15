// @vitest-environment node
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegmentRow } from "../src/data/db/schema";

const mocks = vi.hoisted(() => ({execute: vi.fn(), notify: vi.fn()}));
vi.mock("../src/data/db/client", () => ({
  getDb: () => ({execute: mocks.execute}),
  execute: mocks.execute, select: vi.fn(), insertRow: vi.fn(),
}));
vi.mock("../src/data/db/live", () => ({notifyChanged: mocks.notify}));
import { saveSegmentCorrection, saveSegmentTranslation } from "../src/data/db/repos/transcripts";

const migrations = [
  "0001_init.sql", "0002_mindmap.sql", "0003_text_box_style.sql",
  "0004_deck_recordings.sql", "0005_transcript_original_text.sql",
].map((name) => readFileSync(new URL(`../src-tauri/migrations/${name}`, import.meta.url), "utf8"));

let db: DatabaseSync;
const original = "这堂课我们研究公时。";
const snapshot = {id: "row-a", session_id: "session-a", text: original};

function readRow(id = "row-a"): TranscriptSegmentRow {
  return db.prepare("SELECT * FROM transcript_segments WHERE id = ?").get(id) as unknown as TranscriptSegmentRow;
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const sql of migrations.slice(0, 4)) db.exec(sql);
  const insert = db.prepare("INSERT INTO transcript_segments (id, session_id, source, t0_ms, t1_ms, text, translation, lang, page_index, created_at, updated_at, dirty) VALUES (?, ?, 'device', 100, 1200, ?, 'old translation', 'zh', 3, 'before', 'before', 0)");
  insert.run("row-a", "session-a", original);
  insert.run("row-b", "session-b", original);
  db.exec(migrations[4]);
  mocks.execute.mockReset().mockImplementation(async (sql: string, values: SQLInputValue[]) => {
    const result = db.prepare(sql).run(...values);
    return {rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid)};
  });
  mocks.notify.mockReset();
});

afterEach(() => {db.close();});

describe("transcript correction on migrated SQLite", () => {
  it("migrates an existing transcript without rewriting its text or translation", () => {
    const columns = db.prepare("PRAGMA table_info(transcript_segments)").all();
    expect(columns.find((column) => column.name === "original_text")).toMatchObject({type: "TEXT", notnull: 0, dflt_value: null});
    expect(readRow()).toMatchObject({text: original, original_text: null, translation: "old translation", updated_at: "before", dirty: 0});
    expect(db.prepare("SELECT count(*) AS count FROM transcript_segments").get()?.count).toBe(2);
  });

  it("saves the first ASR text, refreshes language and invalidates the old translation atomically", async () => {
    await saveSegmentCorrection(snapshot, " 这堂课我们研究公式和 Fourier transform。 ");
    expect(readRow()).toMatchObject({
      id: "row-a", session_id: "session-a", text: "这堂课我们研究公式和 Fourier transform。",
      original_text: original, translation: null, lang: "mixed", dirty: 1,
      t0_ms: 100, t1_ms: 1200, page_index: 3, created_at: "before",
    });
    expect(readRow().updated_at).not.toBe("before");
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith("transcript_segments");
  });

  it("preserves the first original across later corrections and discards each stale translation", async () => {
    await saveSegmentCorrection(snapshot, "这堂课我们研究公式。");
    const firstCorrection = readRow();
    db.prepare("UPDATE transcript_segments SET translation = 'translation of first correction' WHERE id = 'row-a'").run();
    await saveSegmentCorrection(firstCorrection, "这堂课我们研究数学公式。");
    expect(readRow()).toMatchObject({text: "这堂课我们研究数学公式。", original_text: original, translation: null});
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });

  it("does not write, clear a translation or notify when the result is unchanged", async () => {
    await saveSegmentCorrection(snapshot, ` ${original} `);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(readRow()).toMatchObject({text: original, original_text: null, translation: "old translation", dirty: 0, updated_at: "before"});
  });

  it("rejects a correction arriving after the user or a newer correction changed the sentence", async () => {
    db.prepare("UPDATE transcript_segments SET text = '用户修改的句子', translation = 'current translation' WHERE id = 'row-a'").run();
    await saveSegmentCorrection(snapshot, "迟到的 AI 结果");
    expect(readRow()).toMatchObject({text: "用户修改的句子", original_text: null, translation: "current translation", updated_at: "before", dirty: 0});
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("cannot update a row belonging to a different recording even when its text matches", async () => {
    await saveSegmentCorrection({...snapshot, session_id: "session-b"}, "错误会话的结果");
    expect(readRow()).toMatchObject({session_id: "session-a", text: original, translation: "old translation", original_text: null});
    expect(readRow("row-b")).toMatchObject({session_id: "session-b", text: original, translation: "old translation", original_text: null});
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("cannot redirect a correction to another segment with a stale ID", async () => {
    await saveSegmentCorrection({...snapshot, id: "missing-id"}, "错误行的结果");
    expect(readRow()).toMatchObject({text: original, original_text: null, translation: "old translation"});
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("does not restore an old translation when a translation request finishes after correction", async () => {
    await saveSegmentCorrection(snapshot, "这堂课我们研究公式。");
    await saveSegmentTranslation(snapshot, "Translation of the obsolete ASR sentence");
    expect(readRow()).toMatchObject({text: "这堂课我们研究公式。", original_text: original, translation: null});
  });

  it("rejects empty and cancelled results before sending any database write", async () => {
    await expect(saveSegmentCorrection(snapshot, " \n ")).rejects.toThrow("纠错结果为空");
    await expect(saveSegmentCorrection(snapshot, "这堂课我们研究公式。", AbortSignal.abort())).rejects.toMatchObject({name: "AbortError"});
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(readRow()).toMatchObject({text: original, original_text: null, translation: "old translation"});
  });

  it("does not notify a change when SQLite rejects the write", async () => {
    db.exec("CREATE TRIGGER reject_correction BEFORE UPDATE ON transcript_segments BEGIN SELECT RAISE(ABORT, 'write rejected'); END;");
    await expect(saveSegmentCorrection(snapshot, "这堂课我们研究公式。")).rejects.toThrow("write rejected");
    expect(readRow()).toMatchObject({text: original, original_text: null, translation: "old translation", dirty: 0});
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
