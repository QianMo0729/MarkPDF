import { describe, expect, it } from "vitest";
import { recordingsForDeck, selectedRecordingId } from "../src/features/session/deckRecordings";
import type { SessionRow } from "../src/data/db/schema";

const recording = (id: string, deckId = "pdf", extra: Partial<SessionRow> = {}) => ({
  id, deck_id: deckId, started_at: "2026-09-15T01:00:00Z", created_at: id,
  deleted_at: null, ...extra,
} as SessionRow);
const idle = { deckId: null, sessionId: null, status: "idle", starting: false };

describe("recordings stay with their PDF", () => {
  const rows = [recording("a"), recording("b"), recording("z", "other"),
    recording("empty", "pdf", { started_at: null }), recording("deleted", "pdf", { deleted_at: "today" })];
  it("shows all and only this PDF's saved recordings, newest first", () => {
    expect(recordingsForDeck(rows, "pdf").map((s) => s.id)).toEqual(["b", "a"]);
    expect(selectedRecordingId("pdf", null, rows, idle)).toBe("b");
  });
  it("keeps explicit reading and older recording selections", () => {
    expect(selectedRecordingId("pdf", "none", rows, idle)).toBe("");
    expect(selectedRecordingId("pdf", "a", rows, idle)).toBe("a");
  });
  it("returns to the active recording on its PDF, never attaches another PDF's recorder", () => {
    const active = { deckId: "pdf", sessionId: "live", status: "paused", starting: false };
    expect(selectedRecordingId("pdf", "a", rows, active)).toBe("live");
    expect(selectedRecordingId("other", "none", rows, active)).toBe("");
  });
  it("keeps a newly created selection while queries catch up", () => {
    expect(selectedRecordingId("pdf", "new", [], idle)).toBe("new");
  });
});
