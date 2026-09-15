import type { IDockviewPanelProps } from "dockview-react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  mode: "live", noteViewMode: "current", page: 0,
  writes: [] as string[],
  pending: [] as { resolve: () => void; reject: (e: Error) => void }[],
}));
vi.mock("../src/data/db/repos/notes", () => ({
  getNote: async () => ({ markdown: "saved text" }),
  upsertNote: (_deck: string, _page: number, markdown: string) => {
    data.writes.push(markdown);
    return new Promise<void>((resolve, reject) => data.pending.push({ resolve, reject }));
  },
}));
vi.mock("../src/stores/settings", () => ({
  useSettings: (select: (s: unknown) => unknown) => select({ settings: { editorMode: "live" }, set: vi.fn() }),
}));
vi.mock("../src/features/session/sessionStore", () => ({
  useSessionUi: (select: (s: unknown) => unknown) => select({ deckId: "deck", mode: data.mode, controller: null, focusRequest: null }),
  useViewerState: () => ({ currentPage: data.page, pageCount: 3 }),
}));
vi.mock("../src/features/session/controllers/recording", () => ({
  useRecording: () => ({ status: "idle", lastSnapshotMs: null, tMs: 0 }),
}));
vi.mock("../src/features/session/controllers/playback", () => ({
  usePlayback: () => ({ noteViewMode: data.noteViewMode, timeline: null, positionMs: 0 }),
}));
vi.mock("../src/editor/MarkdownEditor", async () => {
  const { useState } = await import("react");
  return {
    // Mirror the real editor's contract: `value` initializes a mounted editor;
    // subsequent saves do not replace its current document or cursor position.
    MarkdownEditor: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => {
      const [text, setText] = useState(value);
      return <textarea aria-label="笔记草稿" value={text} onChange={event => { setText(event.target.value); onChange(event.target.value); }} />;
    },
  };
});

import { NotesPanel } from "../src/features/session/panels/NotesPanel";
import { useNoteEditor } from "../src/features/session/controllers/noteEditor";

const props = {} as IDockviewPanelProps;
const completeWrite = async (error?: Error) => {
  const write = data.pending.shift();
  expect(write).toBeDefined();
  await act(async () => { if (error) write!.reject(error); else write!.resolve(); });
};

describe("notes survive panel/mode remounts", () => {
  beforeEach(() => {
    data.mode = "live";
    data.noteViewMode = "current";
    data.page = 0;
    data.writes = [];
    data.pending = [];
    useNoteEditor.setState({ deckId: "deck", page: 0, loadedKey: "deck:0", loadedMarkdown: "saved text", draft: "saved text plus unsaved draft", status: "unsaved", error: null, appendHandler: null, onSavedForSnapshot: null });
  });
  afterEach(async () => {
    cleanup();
    useNoteEditor.setState({ status: "saved" });
    while (data.pending.length) await completeWrite();
    await useNoteEditor.getState().flush();
  });

  it("remounts from the latest draft while unmount saving is still pending, then preserves continued edits", async () => {
    const first = render(<NotesPanel {...props} />);
    expect(screen.getByLabelText("笔记草稿")).toHaveValue("saved text plus unsaved draft");
    first.unmount();
    expect(data.pending).toHaveLength(1);
    data.mode = "reading";
    render(<NotesPanel {...props} />);
    expect(screen.getByLabelText("笔记草稿")).toHaveValue("saved text plus unsaved draft");
    fireEvent.change(screen.getByLabelText("笔记草稿"), { target: { value: "saved text plus unsaved draft and continued editing" } });
    await completeWrite();
    expect(data.pending).toHaveLength(1);
    await completeWrite();
    expect(data.writes).toEqual(["saved text plus unsaved draft", "saved text plus unsaved draft and continued editing"]);
    expect(useNoteEditor.getState()).toMatchObject({ draft: "saved text plus unsaved draft and continued editing", status: "saved" });
  });

  it("retains the draft after a failed save and remount instead of restoring the old saved text", async () => {
    const first = render(<NotesPanel {...props} />);
    first.unmount();
    await completeWrite(new Error("SQLITE_BUSY"));
    expect(useNoteEditor.getState().status).toBe("error");
    render(<NotesPanel {...props} />);
    expect(screen.getByLabelText("笔记草稿")).toHaveValue("saved text plus unsaved draft");
    expect(screen.getByText("保存失败，点击重试")).toBeInTheDocument();
  });

  it("switching from a replay snapshot back to current notes initializes from the draft", () => {
    data.mode = "replay";
    data.noteViewMode = "atTime";
    const view = render(<NotesPanel {...props} />);
    expect(screen.queryByLabelText("笔记草稿")).not.toBeInTheDocument();
    data.noteViewMode = "current";
    view.rerender(<NotesPanel {...props} />);
    expect(screen.getByLabelText("笔记草稿")).toHaveValue("saved text plus unsaved draft");
  });
});
