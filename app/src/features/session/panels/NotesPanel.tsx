import type { IDockviewPanelProps } from "dockview-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { S } from "../../../core/strings";
import { Icon } from "../../../core/ui/Icon";
import { fmtClock, fmtTimestampToken } from "../../../core/utils/time";
import { diffAddedLines } from "../../../domain/note_diff";
import { appendBlock, cycleHeading, insertAtCursor, insertCodeBlock, insertLink, insertMath, toggleLinePrefix, wrapSelection } from "../../../editor/commands";
import { lineHighlight } from "../../../editor/extensions/lineHighlight";
import { MarkdownEditor, type MarkdownEditorHandle } from "../../../editor/MarkdownEditor";
import { useSettings } from "../../../stores/settings";
import { useNoteEditor } from "../controllers/noteEditor";
import { usePlayback } from "../controllers/playback";
import { useRecording } from "../controllers/recording";
import { useSessionUi, useViewerState } from "../sessionStore";
import "./panels.css";
import "./notes.css";

interface ToolButton {
  icon: string;
  label: string;
  run: (view: import("@codemirror/view").EditorView) => void;
}

/** Per-page Markdown notes with Obsidian-style live preview (docs/SPEC.md 6.5.7). */
export function NotesPanel(_props: IDockviewPanelProps) {
  const deckId = useSessionUi((s) => s.deckId);
  const controller = useSessionUi((s) => s.controller);
  const focusRequest = useSessionUi((s) => s.focusRequest);
  const sessionMode = useSessionUi((s) => s.mode);
  const viewer = useViewerState();
  const page = viewer.currentPage;
  const mode = useSettings((s) => s.settings.editorMode);
  const setSetting = useSettings((s) => s.set);
  const note = useNoteEditor();
  const rec = useRecording();
  const pb = usePlayback();
  const handle = useRef<MarkdownEditorHandle | null>(null);
  const noteIsSaved = note.status === "saved";

  useEffect(() => {
    if (deckId) void note.open(deckId, page).catch(() => undefined);
    // A failed write keeps the previous draft open. Once retry saves it, finish
    // loading the requested page even if the reader has not moved again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, page, noteIsSaved]);

  useEffect(() => () => void useNoteEditor.getState().flush().catch(() => undefined), []);

  useEffect(() => {
    note.setAppendHandler((text) => {
      const view = handle.current?.getView();
      if (!view) return false; // the store persists directly (no recursion, audit F2)
      appendBlock(view, text);
      return true;
    });
    return () => note.setAppendHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusRequest?.panel === "notes") handle.current?.focus();
  }, [focusRequest]);

  const run = useCallback((fn: ToolButton["run"]) => {
    const view = handle.current?.getView();
    if (view) fn(view);
  }, []);

  const isLive = sessionMode === "live" && rec.status !== "idle";
  const isReplay = sessionMode === "replay";
  const nowMs = () => (isLive ? rec.tMs : isReplay ? usePlayback.getState().positionMs : null);
  const timestampToken = () => {
    const t = nowMs();
    return t === null ? null : fmtTimestampToken(t);
  };

  const tools: ToolButton[] = [
    { icon: "format_bold", label: "加粗", run: (v) => wrapSelection(v, "**") },
    { icon: "format_italic", label: "斜体", run: (v) => wrapSelection(v, "*") },
    { icon: "title", label: "标题", run: cycleHeading },
    { icon: "format_list_bulleted", label: "列表", run: (v) => toggleLinePrefix(v, "- ") },
    { icon: "checklist", label: "任务列表", run: (v) => toggleLinePrefix(v, "- [ ] ") },
    { icon: "code", label: "代码", run: insertCodeBlock },
    { icon: "function", label: "公式", run: insertMath },
    { icon: "link", label: "链接", run: insertLink },
    { icon: "auto_stories", label: "页面链接", run: (v) => insertAtCursor(v, `[[p${page + 1}]] `) },
    ...(isLive || isReplay ? [{ icon: "timer", label: "插入时间", run: (v: import("@codemirror/view").EditorView) => insertAtCursor(v, timestampToken() ?? "") }] : []),
  ];

  // ----- replay "当时的笔记" -----
  const atTime = isReplay && pb.noteViewMode === "atTime";
  const snapshot = useMemo(() => (atTime && pb.timeline ? pb.timeline.noteAt(page, pb.positionMs) : null), [atTime, pb.timeline, page, pb.positionMs]);
  const addedLineNumbers = useMemo(() => {
    if (!snapshot || !pb.timeline) return [];
    const prev = pb.timeline.previousSnapshot(snapshot)?.markdown ?? "";
    return diffAddedLines(prev, snapshot.markdown)
      .map((l, i) => (l.added ? i + 1 : -1))
      .filter((n) => n > 0);
  }, [snapshot, pb.timeline]);
  const snapshotExtensions = useMemo(() => (snapshot ? [lineHighlight(addedLineNumbers)] : []), [snapshot, addedLineNumbers]);

  const onTimestampClick = isReplay
    ? (ms: number) => {
        pb.seek(ms);
        const p = pb.timeline?.pageAt(ms);
        if (p !== undefined) controller?.goToPage(p);
      }
    : null;

  const ready = deckId !== null && note.loadedKey === `${deckId}:${page}`;
  const documentId = `${deckId}:${page}`;

  return (
    <div className="panel notes-panel">
      <div className="panel-head notes-head">
        <span className="body-small text2">{S.notes.page(page + 1)}</span>
        {!atTime && (
          <div className="segmented" role="radiogroup" aria-label="编辑模式">
            {(["live", "source", "reading"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "selected" : ""} title={m === "live" ? S.notes.live : m === "source" ? S.notes.source : S.notes.reading} onClick={() => void setSetting("editorMode", m)}>
                <Icon name={m === "live" ? "edit" : m === "source" ? "code" : "visibility"} size={16} />
                <span className="notes-mode-label">{m === "live" ? S.notes.live : m === "source" ? S.notes.source : S.notes.reading}</span>
              </button>
            ))}
          </div>
        )}
        <span className={`caption notes-status ${note.status}`} title={note.error ?? undefined}>
          {rec.lastSnapshotMs !== null && isLive ? `${S.notes.recordedAt(fmtClock(rec.lastSnapshotMs))}  ` : ""}
          {note.status === "error" ? (
            <button className="btn btn-text toolbar-small" style={{ color: "var(--record)", height: 20, padding: 0 }} onClick={() => void note.flush().catch(() => undefined)}>
              {S.notes.saveFailed}
            </button>
          ) : note.status === "saved" ? (
            S.notes.saved
          ) : note.status === "saving" ? (
            S.notes.saving
          ) : (
            S.notes.unsaved
          )}
        </span>
      </div>
      {isReplay && (
        <div className="row" style={{ padding: "0 12px 6px" }}>
          <div className="segmented" role="radiogroup">
            <button role="radio" aria-checked={pb.noteViewMode === "atTime"} className={pb.noteViewMode === "atTime" ? "selected" : ""} onClick={() => pb.setNoteViewMode("atTime")}>
              {S.notes.atTime}
            </button>
            <button role="radio" aria-checked={pb.noteViewMode === "current"} className={pb.noteViewMode === "current" ? "selected" : ""} onClick={() => pb.setNoteViewMode("current")}>
              {S.notes.current}
            </button>
          </div>
        </div>
      )}
      {!atTime && mode !== "reading" && (
        <div className="notes-toolbar" role="toolbar" aria-label="格式">
          {tools.map((t) => (
            <button key={t.icon} className="icon-btn notes-tool" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => run(t.run)}>
              <Icon name={t.icon} size={20} />
            </button>
          ))}
        </div>
      )}
      <div className="notes-body">
        {atTime ? (
          snapshot ? (
            <MarkdownEditor
              key={snapshot.id}
              documentId={`snap:${snapshot.id}`}
              value={snapshot.markdown}
              mode="reading"
              onChange={() => undefined}
              pageCount={viewer.pageCount}
              onOpenPage={(p) => controller?.goToPage(p)}
              onTimestampClick={onTimestampClick}
              extraExtensions={snapshotExtensions}
            />
          ) : (
            <div className="empty" style={{ height: "100%" }}>
              <div className="caption">{S.notes.noSnapshotYet}</div>
            </div>
          )
        ) : (
          ready && (
            <MarkdownEditor
              documentId={documentId}
              value={note.draft}
              mode={mode}
              onChange={note.onChange}
              placeholder={S.notes.placeholder(page + 1)}
              pageCount={viewer.pageCount}
              onOpenPage={(p) => controller?.goToPage(p)}
              onTimestampClick={onTimestampClick}
              timestampToken={timestampToken}
              handleRef={handle}
            />
          )
        )}
      </div>
    </div>
  );
}
