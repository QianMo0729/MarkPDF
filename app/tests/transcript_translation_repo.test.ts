import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), notify: vi.fn() }));
vi.mock("../src/data/db/client", () => ({ execute: mocks.execute, select: vi.fn(), insertRow: vi.fn() }));
vi.mock("../src/data/db/live", () => ({ notifyChanged: mocks.notify }));
import { saveSegmentTranslation } from "../src/data/db/repos/transcripts";

beforeEach(() => { mocks.execute.mockReset().mockResolvedValue(undefined); mocks.notify.mockReset(); });

describe("transcript translation persistence", () => {
  it("guards the exact recording, row and original text and leaves existing translations intact", async () => {
    await saveSegmentTranslation({ id: "row-a", session_id: "session-a", text: "Original text" }, " 译文 ");
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain("WHERE id = ? AND session_id = ? AND text = ?");
    expect(sql).toContain("translation IS NULL OR trim(translation) = ''");
    expect(sql).toContain("dirty = 1");
    expect(params).toEqual(["译文", expect.any(String), "row-a", "session-a", "Original text"]);
    expect(mocks.notify).toHaveBeenCalledWith("transcript_segments");
  });
  it("does not issue a write after cancellation", async () => {
    const ctrl = new AbortController(); ctrl.abort();
    await expect(saveSegmentTranslation({ id: "row-a", session_id: "session-a", text: "Original" }, "译文", ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects an empty translation and does not report a failed database write as successful", async () => {
    await expect(saveSegmentTranslation({ id: "row-a", session_id: "session-a", text: "Original" }, " ")).rejects.toThrow("为空");
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.execute.mockRejectedValueOnce(new Error("disk error"));
    await expect(saveSegmentTranslation({ id: "row-a", session_id: "session-a", text: "Original" }, "译文")).rejects.toThrow("disk error");
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
