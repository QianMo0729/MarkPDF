import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({getNote: vi.fn(), upsertNote: vi.fn()}));
vi.mock("../src/data/db/repos/notes", () => mocks);
import { useNoteEditor } from "../src/features/session/controllers/noteEditor";

const table = new Map<string, string>();
const settle = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  table.clear();
  table.set("a:0", "saved A");
  table.set("b:0", "saved B");
  mocks.getNote.mockReset().mockImplementation(async (deck: string, page: number) => ({markdown: table.get(`${deck}:${page}`) ?? ""}));
  mocks.upsertNote.mockReset().mockImplementation(async (deck: string, page: number, text: string) => {table.set(`${deck}:${page}`, text);});
  useNoteEditor.setState({deckId: null, page: 0, loadedKey: null, loadedMarkdown: "", draft: "", status: "saved", error: null, appendHandler: null, onSavedForSnapshot: null});
});

afterEach(() => {vi.clearAllTimers(); vi.useRealTimers();});

describe("note navigation preserves the only unsaved draft", () => {
  it("rejects switching PDFs after SQLite failure and keeps the original draft for retry", async () => {
    await useNoteEditor.getState().open("a", 0);
    useNoteEditor.getState().onChange("UNSAVED A");
    mocks.upsertNote.mockRejectedValueOnce(new Error("SQLITE_FULL"));
    await expect(useNoteEditor.getState().open("b", 0)).rejects.toThrow("SQLITE_FULL");
    expect(useNoteEditor.getState()).toMatchObject({loadedKey: "a:0", draft: "UNSAVED A", status: "error"});
    expect(table.get("a:0")).toBe("saved A");
    expect(mocks.getNote).not.toHaveBeenCalledWith("b", 0);
    await useNoteEditor.getState().open("b", 0);
    expect(table.get("a:0")).toBe("UNSAVED A");
    expect(useNoteEditor.getState()).toMatchObject({loadedKey: "b:0", draft: "saved B", status: "saved"});
  });

  it("returning A to B to A invalidates B's delayed read even though A was still loaded", async () => {
    await useNoteEditor.getState().open("a", 0);
    let resolveB!: (row: {markdown: string}) => void;
    mocks.getNote.mockImplementationOnce(() => new Promise((resolve) => {resolveB = resolve;}));
    const openB = useNoteEditor.getState().open("b", 0);
    await settle();
    await useNoteEditor.getState().open("a", 0);
    useNoteEditor.getState().onChange("A after returning");
    resolveB({markdown: "delayed B"});
    await openB;
    expect(useNoteEditor.getState()).toMatchObject({loadedKey: "a:0", draft: "A after returning", status: "unsaved"});
  });

  it("automatic debounce and retry handle rejection without an unhandled promise", async () => {
    await useNoteEditor.getState().open("a", 0);
    mocks.upsertNote.mockRejectedValueOnce(new Error("SQLITE_BUSY"));
    useNoteEditor.getState().onChange("A pending retry");
    await vi.advanceTimersByTimeAsync(1500);
    expect(useNoteEditor.getState()).toMatchObject({draft: "A pending retry", status: "error"});
    expect(table.get("a:0")).toBe("saved A");
    await vi.advanceTimersByTimeAsync(5000);
    expect(useNoteEditor.getState().status).toBe("saved");
    expect(table.get("a:0")).toBe("A pending retry");
    expect(mocks.upsertNote).toHaveBeenCalledTimes(2);
  });

  it("automatic window blur keeps the failed draft while handling the rejected promise", async () => {
    await useNoteEditor.getState().open("a", 0);
    useNoteEditor.getState().onChange("A before blur");
    mocks.upsertNote.mockRejectedValueOnce(new Error("SQLITE_FULL"));
    window.dispatchEvent(new Event("blur"));
    await settle();
    expect(useNoteEditor.getState()).toMatchObject({loadedKey: "a:0", draft: "A before blur", status: "error"});
    expect(table.get("a:0")).toBe("saved A");
  });

  it("all explicit callers learn that their shared pending write failed", async () => {
    await useNoteEditor.getState().open("a", 0);
    useNoteEditor.getState().onChange("A concurrent save");
    let rejectWrite!: (error: Error) => void;
    mocks.upsertNote.mockImplementationOnce(() => new Promise((_resolve, reject) => {rejectWrite = reject;}));
    const first = useNoteEditor.getState().flush();
    const second = useNoteEditor.getState().flush();
    const completed = Promise.allSettled([first, second]);
    rejectWrite(new Error("SQLITE_BUSY"));
    expect((await completed).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(useNoteEditor.getState()).toMatchObject({draft: "A concurrent save", status: "error"});
  });
});
