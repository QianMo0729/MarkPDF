import { beforeEach, describe, expect, it, vi } from "vitest";

// The store talks to SQLite through the notes repo; replace it with an in-memory
// table whose reads can be delayed to reproduce the audit's race (F3).
const table = new Map<string, string>();
const pending: (() => void)[] = [];
let failWrites = false;
vi.mock("../src/data/db/repos/notes", () => ({
  getNote: (deckId: string, page: number) =>
    new Promise((resolve) => {
      pending.push(() => {
        const md = table.get(`${deckId}:${page}`);
        resolve(md === undefined ? null : { id: "n", deck_id: deckId, page_index: page, markdown: md, created_at: "", updated_at: "", dirty: 0 });
      });
    }),
  upsertNote: async (deckId: string, page: number, markdown: string) => {
    if (failWrites) throw new Error("SQLITE_FULL");
    table.set(`${deckId}:${page}`, markdown);
    return { id: "n", deck_id: deckId, page_index: page, markdown, created_at: "", updated_at: "", dirty: 0 };
  },
}));

const { useNoteEditor } = await import("../src/features/session/controllers/noteEditor");

const flushPending = (i = 0) => pending.splice(i, 1)[0]?.();
/** Let every queued microtask run (an await chain inside the store). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("noteEditor", () => {
  beforeEach(() => {
    table.clear();
    pending.length = 0;
    failWrites = false;
    useNoteEditor.setState({ deckId: null, page: 0, loadedMarkdown: "", loadedKey: null, draft: "", status: "saved", error: null, appendHandler: null });
  });

  it("a slow query for the previous page never overwrites the page the user is editing", async () => {
    table.set("deck:1", "PAGE 1");
    table.set("deck:2", "PAGE 2");
    const s = useNoteEditor.getState();
    const open1 = s.open("deck", 1);
    await settle(); // page 1's query is now in flight
    expect(pending.length).toBe(1);
    const open2 = s.open("deck", 2);
    await settle();
    expect(pending.length).toBe(2);
    // Page 2's query answers first…
    flushPending(1);
    await open2;
    expect(useNoteEditor.getState().loadedKey).toBe("deck:2");
    useNoteEditor.getState().onChange("PAGE 2 + edit after loading");
    // …then the stale page-1 query arrives.
    flushPending(0);
    await open1;
    const now = useNoteEditor.getState();
    expect(now.loadedKey).toBe("deck:2");
    expect(now.draft).toBe("PAGE 2 + edit after loading");
    expect(now.status).toBe("unsaved");
  });

  it("appending without an editor view persists directly instead of recursing", async () => {
    table.set("deck:3", "existing");
    const s = useNoteEditor.getState();
    const open = s.open("deck", 3);
    await settle();
    flushPending();
    await open;
    let calls = 0;
    useNoteEditor.getState().setAppendHandler(() => {
      calls += 1;
      return false; // no view mounted
    });
    await useNoteEditor.getState().appendToCurrentNote("> quoted");
    expect(calls).toBe(1);
    expect(table.get("deck:3")).toBe("existing\n\n> quoted\n");
    expect(useNoteEditor.getState().status).toBe("saved");
  });

  it("a failed write keeps the draft, reports the error and can be retried", async () => {
    table.set("deck:4", "");
    const s = useNoteEditor.getState();
    const open = s.open("deck", 4);
    await settle();
    flushPending();
    await open;
    useNoteEditor.getState().onChange("typed text");
    failWrites = true;
    await expect(useNoteEditor.getState().flush()).rejects.toThrow("SQLITE_FULL");
    let now = useNoteEditor.getState();
    expect(now.status).toBe("error");
    expect(now.error).toContain("SQLITE_FULL");
    expect(now.draft).toBe("typed text");
    failWrites = false;
    await useNoteEditor.getState().flush();
    now = useNoteEditor.getState();
    expect(now.status).toBe("saved");
    expect(table.get("deck:4")).toBe("typed text");
  });

  it("flush() waits for a write already in progress and then writes newer edits", async () => {
    table.set("deck:5", "");
    const s = useNoteEditor.getState();
    const open = s.open("deck", 5);
    await settle();
    flushPending();
    await open;
    useNoteEditor.getState().onChange("first");
    const f1 = useNoteEditor.getState().flush();
    useNoteEditor.getState().onChange("first second");
    const f2 = useNoteEditor.getState().flush();
    await Promise.all([f1, f2]);
    expect(table.get("deck:5")).toBe("first second");
    expect(useNoteEditor.getState().status).toBe("saved");
  });
});
