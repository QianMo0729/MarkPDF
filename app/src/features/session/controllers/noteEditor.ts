import { create } from "zustand";
import { getNote, upsertNote } from "../../../data/db/repos/notes";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

const SAVE_DEBOUNCE_MS = 1500;
/** A failed write is retried on its own after this long; the status row also offers a manual retry. */
const SAVE_RETRY_MS = 5000;

interface NoteEditorStore {
  deckId: string | null;
  page: number;
  /** Document as loaded from the DB; the editor owns edits after mount. */
  loadedMarkdown: string;
  loadedKey: string | null;
  draft: string;
  status: SaveStatus;
  /** Last write error, shown next to the status. */
  error: string | null;
  /**
   * NotesPanel registers this so "add to notes" can insert into the live editor.
   * Returns false when no editor view is mounted; the store then persists directly.
   */
  appendHandler: ((text: string) => boolean) | null;
  /** Set by the recording controller in live mode (docs/SPEC.md 5.3). */
  onSavedForSnapshot: ((page: number, markdown: string) => void) | null;
  open: (deckId: string, page: number) => Promise<void>;
  onChange: (markdown: string) => void;
  /** Writes the draft if it is dirty. Awaiting it guarantees the DB holds the latest text. */
  flush: () => Promise<void>;
  setAppendHandler: (fn: ((text: string) => boolean) | null) => void;
  appendToCurrentNote: (text: string) => Promise<void>;
}

let timer: number | null = null;
/** Monotonic request number: a slow getNote() must never overwrite a newer page (audit F3). */
let openSeq = 0;
/** The write in progress, so concurrent flush() callers wait for it instead of skipping. */
let inflight: Promise<void> | null = null;

export const useNoteEditor = create<NoteEditorStore>((set, get) => ({
  deckId: null,
  page: 0,
  loadedMarkdown: "",
  loadedKey: null,
  draft: "",
  status: "saved",
  error: null,
  appendHandler: null,
  onSavedForSnapshot: null,

  open: async (deckId, page) => {
    // Returning to the currently loaded page is still a new navigation request;
    // invalidate any slower request for the page we just left.
    const my = ++openSeq;
    const key = `${deckId}:${page}`;
    if (get().loadedKey === key) return;
    await get().flush();
    if (my !== openSeq) return;
    const row = await getNote(deckId, page);
    if (my !== openSeq) return; // a newer open() won; drop this result
    const md = row?.markdown ?? "";
    set({ deckId, page, loadedMarkdown: md, loadedKey: key, draft: md, status: "saved", error: null });
  },

  onChange: (markdown) => {
    const s = get();
    if (markdown === s.draft) return;
    set({ draft: markdown, status: "unsaved" });
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => void get().flush().catch(() => undefined), SAVE_DEBOUNCE_MS);
  },

  flush: async () => {
    if (inflight) {
      await inflight;
      // Edits that arrived during that write are still dirty: write them too.
      if (get().status !== "unsaved" && get().status !== "error") return;
    }
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
    const s = get();
    if (!s.deckId || s.status === "saved") return;
    const key = s.loadedKey;
    set({ status: "saving" });
    const run = (async () => {
      try {
        await upsertNote(s.deckId as string, s.page, s.draft);
      } catch (e) {
        // Keep the draft, say so, and try again by itself (audit PM-05).
        if (get().loadedKey === key) {
          set({ status: "error", error: String(e instanceof Error ? e.message : e) });
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => void get().flush().catch(() => undefined), SAVE_RETRY_MS);
        }
        // Explicit callers must stop navigation/export instead of replacing the
        // only unsaved draft. Automatic saves catch this after retaining status.
        throw e;
      }
      const now = get();
      if (now.loadedKey === key) {
        if (now.draft === s.draft) set({ status: "saved", loadedMarkdown: s.draft, error: null });
        else set({ status: "unsaved", error: null });
      }
      s.onSavedForSnapshot?.(s.page, s.draft);
    })();
    inflight = run;
    try {
      await run;
    } finally {
      if (inflight === run) inflight = null;
    }
    if (get().loadedKey === key && get().status === "unsaved") await get().flush();
  },

  setAppendHandler: (fn) => set({ appendHandler: fn }),

  appendToCurrentNote: async (text) => {
    const s = get();
    if (s.appendHandler?.(text)) return;
    // No editor view (panel closed, replay "当时的笔记", still loading): persist directly.
    if (!s.deckId) throw new Error("no note is open");
    const base = s.draft.replace(/\s+$/, "");
    const next = `${base}${base ? "\n\n" : ""}${text.trim()}\n`;
    set({ draft: next, status: "unsaved" });
    await get().flush();
  },
}));

window.addEventListener("blur", () => void useNoteEditor.getState().flush().catch(() => undefined));
