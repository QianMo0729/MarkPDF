import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { join } from "@tauri-apps/api/path";
import { useLayoutClass } from "../../core/layout/breakpoints";
import { S } from "../../core/strings";
import { useContextMenu } from "../../core/ui/ContextMenu";
import { ConfirmDialog } from "../../core/ui/Dialog";
import { Icon } from "../../core/ui/Icon";
import { PromptDialog } from "../../core/ui/PromptDialog";
import { toast } from "../../core/ui/Toast";
import { fmtDateTime, fmtDuration } from "../../core/utils/time";
import { useLiveQuery } from "../../data/db/live";
import { listAnnotations } from "../../data/db/repos/annotations";
import { getDeck, getDeckPages, updateDeck } from "../../data/db/repos/decks";
import { getSession, listSessionsForDeck, updateSession } from "../../data/db/repos/sessions";
import { MoveDeckDialog } from "../course/MoveDeckDialog";
import { recordingsForDeck, selectedRecordingId } from "./deckRecordings";
import { NoModelError, useRetranscribe } from "./controllers/retranscribe";
import { deleteSessionWithFiles } from "../../domain/deletion";
import { printFile } from "../../platform/files";
import { onMenuCommand, syncMenu } from "../../platform/menu";
import { isMac, shortcutLabel } from "../../platform/os";
import { getState, setState } from "../../data/db/repos/syncState";
import { cacheDir, sessionWavPath } from "../../data/files/file_store";
import { activatePanel, DockHost, type PanelComponent } from "../../dock/DockHost";
import { panelsForMode, type PanelId, type SessionMode } from "../../dock/panelRegistry";
import { exportAnnotatedPdf } from "../../domain/export_pdf";
import { CSS_PX_PER_PT, selectionQuads, type PageGeom } from "../../pdf/coords";
import { usePdfDocument } from "../../pdf/documents";
import { AnnotationLayer, type LayerStyle } from "../../pdf/layers/AnnotationLayer";
import { PdfViewer } from "../../pdf/PdfViewer";
import type { SelectionAction } from "../../pdf/SelectionToolbar";
import { copyText } from "../../platform/clipboard";
import { saveBytesWithDialog, writeBytes } from "../../platform/saveFile";
import { useSettings } from "../../stores/settings";
import { useAnnotationStore } from "./controllers/annotations";
import { useNoteEditor } from "./controllers/noteEditor";
import { usePlayback } from "./controllers/playback";
import { useRecording } from "./controllers/recording";
import { useTranslateStore } from "./controllers/translate";
import { TranscriptTranslationProvider } from "./controllers/TranscriptTranslationContext";
import { useTimeline } from "./hooks/useTimeline";
import { createSession } from "./sessionFlows";
import { AnnotationsPanel } from "./panels/AnnotationsPanel";
import { MindmapPanel } from "./panels/MindmapPanel";
import { useMindmap } from "./controllers/mindmap";
import { getAnnotation } from "../../data/db/repos/annotations";
import { NotesPanel } from "./panels/NotesPanel";
import { OutlinePanel } from "./panels/OutlinePanel";
import { SearchPanel } from "./panels/SearchPanel";
import { SummaryPanel } from "./panels/SummaryPanel";
import { TranscriptPanel } from "./panels/TranscriptPanel";
import { ExplainPanel, TranslatePanel } from "./panels/TranslatePanel";
import { exportDeckMarkdown, exportSessionMarkdown } from "../../domain/export_markdown";
import { useSessionUi, useViewerState, type Tool } from "./sessionStore";
import { SlideToolbar } from "./widgets/SlideToolbar";
import { ThumbnailRail } from "./widgets/ThumbnailRail";
import { TimelineScrubber } from "./widgets/TimelineScrubber";
import { TransportBarLive } from "./widgets/TransportBarLive";
import { TransportBarReplay } from "./widgets/TransportBarReplay";
import "./session.css";

interface Props {
  kind: "deck" | "session";
}

const DOCK_WIDTH_KEY = "side_panel_width";

/** Divider drags: capture the pointer (mouse, pen or finger) and end on release or cancel. */
function trackDividerPointer(e: React.PointerEvent, onMove: (ev: PointerEvent) => void, onEnd: () => void): void {
  const target = e.currentTarget as HTMLElement;
  const id = e.pointerId;
  try { target.setPointerCapture(id); } catch { /* ignore */ }
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    try { if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id); } catch { /* ignore */ }
    onEnd();
  };
  const move = (ev: PointerEvent) => { if (ev.pointerId === id) onMove(ev); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}
const DOCK_MIN = 320;
const DOCK_DEFAULT = 400;
const RAIL_MIN = 96;
const RAIL_MAX = 320;

const PANEL_COMPONENTS: Partial<Record<PanelId, PanelComponent>> = {
  notes: NotesPanel,
  mindmap: MindmapPanel,
  annotations: AnnotationsPanel,
  outline: OutlinePanel,
  search: SearchPanel,
  translate: TranslatePanel,
  explain: ExplainPanel,
  transcript: TranscriptPanel,
  summary: SummaryPanel,
};

const EDITOR_MODES = ["live", "source", "reading"] as const;
const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "highlight", d: "draw", t: "text", e: "erase" };

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  return !!el.closest(".cm-editor");
}

/** Session screen for reading / live / replay (docs/SPEC.md 6.5). */
export function SessionScreen({ kind }: Props) {
  const { deckId = "", sessionId: legacySessionId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const layout = useLayoutClass();
  const setDeckIdInStore = useSessionUi((s) => s.setDeckId);
  const setModeInStore = useSessionUi((s) => s.setMode);
  const tool = useSessionUi((s) => s.tool);
  const setTool = useSessionUi((s) => s.setTool);
  const requestFocus = useSessionUi((s) => s.requestFocus);
  const settings = useSettings((s) => s.settings);
  const setSetting = useSettings((s) => s.set);
  const railCollapsed = settings.railCollapsed;
  const recordingsBarOpen = !settings.recordingsBarCollapsed;
  const viewer = useViewerState();

  const rec = useRecording();
  const deckSessions = useLiveQuery(() => kind === "deck" ? listSessionsForDeck(deckId) : Promise.resolve([]), ["sessions"], [kind, deckId]);
  const sessionId = kind === "session" ? legacySessionId : selectedRecordingId(deckId, searchParams.get("recording"), deckSessions.data ?? [], rec);
  const session = useLiveQuery(async () => {
    const row = sessionId ? await getSession(sessionId) : null;
    return row && (kind === "session" || row.deck_id === deckId) ? row : null;
  }, ["sessions"], [kind, sessionId, deckId]);
  const effectiveDeckId = kind === "deck" ? deckId : (session.data?.deck_id ?? "");
  const deckQuery = useLiveQuery(() => (effectiveDeckId ? getDeck(effectiveDeckId) : Promise.resolve(null)), ["decks"], [effectiveDeckId]);
  // Live queries retain cached data while a different PDF loads. Actions must
  // never use that previous PDF's row under the new route.
  const deck = { ...deckQuery, data: deckQuery.data?.id === effectiveDeckId ? deckQuery.data : null };
  const activeDeckId = useRef(effectiveDeckId);
  activeDeckId.current = effectiveDeckId;
  useEffect(() => {
    activeDeckId.current = effectiveDeckId;
    return () => { activeDeckId.current = ""; };
  }, [effectiveDeckId]);
  const pages = useLiveQuery(() => (effectiveDeckId ? getDeckPages(effectiveDeckId) : Promise.resolve([])), ["deck_pages"], [effectiveDeckId]);
  const pageSizes = useMemo(() => (pages.data ?? []).filter((p) => p.deck_id === effectiveDeckId).map((p) => ({ width: p.width_pt, height: p.height_pt })), [pages.data, effectiveDeckId]);

  const mode: SessionMode = useMemo(() => {
    if (!sessionId || session.data?.id !== sessionId || (kind === "deck" && session.data.deck_id !== deckId)) return "reading";
    const active = rec.sessionId === sessionId && (rec.status !== "idle" || rec.starting);
    return session.data.ended_at || (session.data.started_at && !active) ? "replay" : "live";
  }, [kind, deckId, sessionId, session.data, rec.sessionId, rec.status, rec.starting]);

  useEffect(() => {
    setDeckIdInStore(effectiveDeckId || null);
    useAnnotationStore.getState().reset();
    return () => {
      setDeckIdInStore(null);
      useAnnotationStore.getState().reset();
    };
  }, [effectiveDeckId, setDeckIdInStore]);
  useEffect(() => setModeInStore(mode), [mode, setModeInStore]);
  useEffect(() => {
    useSessionUi.getState().setSessionId(mode !== "reading" ? sessionId : null);
    return () => useSessionUi.getState().setSessionId(null);
  }, [mode, sessionId]);

  const { doc, error: docError } = usePdfDocument(effectiveDeckId || null);
  const title = deck.data?.title ?? "";

  // Keep old session links working, with the PDF as the canonical destination.
  useEffect(() => {
    if (kind !== "session" || session.data?.id !== legacySessionId) return;
    const params = new URLSearchParams(searchParams);
    params.set("recording", legacySessionId);
    navigate(`/deck/${session.data.deck_id}?${params}`, { replace: true });
  }, [kind, legacySessionId, session.data, navigate, searchParams]);

  // ----- live recording -----
  // Another class is still recording while this screen opens (audit PM-01): that
  // recorder is left untouched; the user goes back to it or ends it first.
  const recordingElsewhere = (rec.status !== "idle" || rec.starting) && rec.sessionId !== null && rec.deckId !== effectiveDeckId;
  useEffect(() => {
    if (mode === "live" && session.data && effectiveDeckId) rec.attach(session.data.id, effectiveDeckId);
    return () => {
      const r = useRecording.getState();
      if (r.status === "idle" && r.sessionId === session.data?.id) r.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, session.data?.id, effectiveDeckId, rec.status === "idle"]);
  useEffect(() => {
    if (mode === "live" && rec.status !== "idle" && rec.sessionId === sessionId && rec.deckId === effectiveDeckId) rec.onPageChanged(viewer.currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.currentPage, mode, rec.status, sessionId, effectiveDeckId]);
  // Deck reader → record button: a class on this deck, opened at the current page, recording at once.
  const creatingRecording = useRef(false);
  const [creating, setCreating] = useState(false);
  const startClass = async () => {
    const active = useRecording.getState();
    if (!deck.data || creatingRecording.current || active.status !== "idle" || active.starting) return;
    const selectedDeck = deck.data;
    const initialPage = viewer.currentPage;
    creatingRecording.current = true;
    setCreating(true);
    try {
      await useNoteEditor.getState().flush();
      const afterSave = useRecording.getState();
      if (activeDeckId.current !== selectedDeck.id || afterSave.status !== "idle" || afterSave.starting) return;
      usePlayback.getState().unload();
      const s = await createSession(selectedDeck.course_id, selectedDeck.id);
      await updateSession(s.id, { initial_page_index: initialPage });
      if (activeDeckId.current === selectedDeck.id) navigate(`/deck/${selectedDeck.id}?recording=${s.id}&start=1`, { replace: true });
    } catch (e) {
      toast(S.errors.generic(String(e)), "error");
    } finally {
      creatingRecording.current = false;
      setCreating(false);
    }
  };
  const autoStart = searchParams.get("start") === "1";
  useEffect(() => {
    if (!autoStart || mode !== "live" || !session.data || viewer.pagesReady === 0) return;
    if (rec.sessionId !== session.data.id || rec.status !== "idle" || rec.starting) return;
    const params = new URLSearchParams(searchParams);
    params.delete("start");
    setSearchParams(params, { replace: true });
    void rec.start(viewer.currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, mode, session.data?.id, rec.sessionId, rec.status, viewer.pagesReady]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // ----- replay playback -----
  const pb = usePlayback();
  const timeline = useTimeline(session.data?.id === sessionId && mode !== "reading" ? session.data : null, mode === "live" ? rec.tMs : undefined);
  useEffect(() => {
    if (mode !== "replay" || !session.data) return;
    let alive = true;
    (async () => {
      const path = session.data!.local_wav_path ?? (await sessionWavPath(session.data!.id));
      if (alive) pb.load(session.data!.id, path, session.data!.duration_ms ?? 0, settings.playbackSpeed);
    })();
    return () => {
      alive = false;
      usePlayback.getState().unload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, session.data?.id]);
  useEffect(() => () => usePlayback.getState().unload(), []);
  useEffect(() => pb.setTimeline(timeline), [timeline, pb.setTimeline]);

  // Follow pages while playing; a manual page change turns following off (docs/SPEC.md 6.5.4).
  // `autoPage` is the page the player itself last navigated to (or found itself on):
  // any other current page can only come from the user (audit PM-04).
  const autoPage = useRef<number | null>(null);
  useEffect(() => {
    if (mode === "replay") autoPage.current = viewer.currentPage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sessionId]);
  useEffect(() => {
    if (mode !== "replay" || !timeline || !pb.followPages) return;
    // A current page the player did not set is a manual flip still being handled by
    // the effect below (or a jump still in flight): never pull it back.
    if (autoPage.current !== null && autoPage.current !== viewer.currentPage) return;
    const page = timeline.pageAt(pb.positionMs);
    autoPage.current = page;
    if (page !== viewer.currentPage) useSessionUi.getState().controller?.goToPage(page, { recordHistory: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb.positionMs, pb.followPages, timeline, mode, viewer.currentPage]);
  useEffect(() => {
    if (mode !== "replay" || !pb.followPages) return;
    if (autoPage.current !== null && autoPage.current !== viewer.currentPage) pb.setFollowPages(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.currentPage]);
  const jumpTo = useCallback(
    (ms: number) => {
      pb.seek(ms);
      const page = timeline?.pageAt(ms);
      if (page !== undefined) {
        autoPage.current = page;
        useSessionUi.getState().controller?.goToPage(page);
      }
    },
    [pb, timeline],
  );
  const atTime = mode === "replay" && pb.noteViewMode === "atTime";
  const replayRows = useMemo(() => (atTime && timeline ? timeline.annotationsAtAll(pb.positionMs) : null), [atTime, timeline, pb.positionMs]);

  // ----- dock / rail layout -----
  const [dockWidth, setDockWidth] = useState(DOCK_DEFAULT);
  useEffect(() => {
    getState(DOCK_WIDTH_KEY).then((v) => {
      const n = Number(v);
      if (Number.isFinite(n) && n >= DOCK_MIN) setDockWidth(n);
    });
  }, []);
  const [dockOpen, setDockOpen] = useState(true);
  const [railOverlay, setRailOverlay] = useState(false);
  const expanded = layout === "expanded";
  const railOpen = expanded ? !railCollapsed : railOverlay;
  // Rail width: dragged live, persisted on release (docs/SPEC.md 6.5.2).
  const railWidthSetting = useSettings((s) => s.settings.railWidth);
  const [railWidthLive, setRailWidthLive] = useState<number | null>(null);
  const railWidth = railWidthLive ?? Math.min(RAIL_MAX, Math.max(RAIL_MIN, railWidthSetting));
  const startRailResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = railWidth;
    const clamp = (x: number) => Math.min(RAIL_MAX, Math.max(RAIL_MIN, startW + (x - startX)));
    let lastX = startX;
    trackDividerPointer(e, (ev) => { lastX = ev.clientX; setRailWidthLive(clamp(ev.clientX)); }, () => {
      setRailWidthLive(null);
      void setSetting("railWidth", clamp(lastX));
    });
  };
  const toggleRail = useCallback(() => {
    if (expanded) void setSetting("railCollapsed", !railCollapsed);
    else setRailOverlay((v) => !v);
  }, [expanded, railCollapsed, setSetting]);

  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    const max = Math.floor(window.innerWidth * 0.5);
    const clamp = (x: number) => Math.min(max, Math.max(DOCK_MIN, startW + (startX - x)));
    let lastX = startX;
    trackDividerPointer(e, (ev) => { lastX = ev.clientX; setDockWidth(clamp(ev.clientX)); }, () => {
      setState(DOCK_WIDTH_KEY, String(clamp(lastX))).catch(() => undefined);
    });
  };

  // ----- export / print -----
  const exportPdf = async () => {
    if (!deck.data || !pages.data) return;
    try {
      const rows = await listAnnotations(deck.data.id);
      const result = await exportAnnotatedPdf(deck.data, pages.data, rows);
      const path = await saveBytesWithDialog(`${deck.data.title} - 标注.pdf`, result.bytes, [{ name: "PDF", extensions: ["pdf"] }]);
      if (path) toast(result.failed ? `${S.toast.exported(path)}（${result.failed} 条标注未能写入）` : S.toast.exported(path));
    } catch (e) {
      toast(S.errors.generic(String(e)), "error");
    }
  };
  const exportMarkdown = async () => {
    try {
      await useNoteEditor.getState().flush(); // the export must contain what was just typed (audit PM-03)
      const md = mode !== "reading" && session.data ? await exportSessionMarkdown(session.data.id) : effectiveDeckId ? await exportDeckMarkdown(effectiveDeckId) : "";
      if (!md) return;
      const path = await saveBytesWithDialog(`${title || "MarkPDF"}.md`, new TextEncoder().encode(md), [{ name: "Markdown", extensions: ["md"] }]);
      if (path) toast(S.toast.exported(path));
    } catch (e) {
      toast(S.errors.generic(String(e)), "error");
    }
  };
  const printPdf = async () => {
    if (!deck.data || !pages.data) return;
    try {
      const rows = await listAnnotations(deck.data.id);
      const result = await exportAnnotatedPdf(deck.data, pages.data, rows);
      const path = await join(await cacheDir(), "print", `${deck.data.id}.pdf`);
      await writeBytes(path, result.bytes);
      try {
        if ((await printFile(path)) === "opened_in_viewer") toast(S.session.printInPreview);
      } catch {
        // Nothing handles printing PDFs (or the default viewer has no print verb): hand
        // the file over instead of "opening" it, which could loop back into MarkPDF.
        toast(S.session.printFallback, "error");
        await revealItemInDir(path).catch(() => undefined);
      }
    } catch (e) {
      toast(S.errors.generic(String(e)), "error");
    }
  };

  // ----- macOS menu bar: commands without a shortcut, and what the menu should offer -----
  const menuActions = useRef({ exportMarkdown, printPdf });
  menuActions.current = { exportMarkdown, printPdf };
  useEffect(() => {
    const unlisten = onMenuCommand((command) => {
      if (command === "export-markdown") void menuActions.current.exportMarkdown();
      else if (command === "print") void menuActions.current.printPdf();
    });
    return () => void unlisten.then((fn) => fn());
  }, []);
  useEffect(() => {
    syncMenu({ session: true, live: mode === "live", recording: mode === "live" && rec.status !== "idle", railOpen, dockOpen });
  }, [mode, rec.status, railOpen, dockOpen]);
  useEffect(() => () => syncMenu({ session: false, live: false, recording: false, railOpen: false, dockOpen: false }), []);

  // ----- keyboard shortcuts (docs/SPEC.md 6.6) -----
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const ui = useSessionUi.getState();
      const ann = useAnnotationStore.getState();
      const recording = useRecording.getState();
      const playback = usePlayback.getState();
      const c = ui.controller;
      const key = e.key;
      const editable = isEditableTarget(e.target);
      if (ctrl && key.toLowerCase() === "f") {
        e.preventDefault();
        setDockOpen(true);
        requestFocus("search");
        return;
      }
      if (ctrl && key === "\\") {
        e.preventDefault();
        if (e.shiftKey) toggleRail();
        else setDockOpen((v) => !v);
        return;
      }
      if (ctrl && /^[1-9]$/.test(key)) {
        const def = panelsForMode(mode)[Number(key) - 1];
        if (def && ui.dockApi) {
          e.preventDefault();
          setDockOpen(true);
          activatePanel(ui.dockApi, def.id);
        }
        return;
      }
      if (ctrl && (key === "=" || key === "+")) {
        e.preventDefault();
        c?.zoomIn();
        return;
      }
      if (ctrl && key === "-") {
        e.preventDefault();
        c?.zoomOut();
        return;
      }
      if (ctrl && key === "0") {
        e.preventDefault();
        c?.setScaleValue("page-width");
        return;
      }
      if (ctrl && key.toLowerCase() === "e" && !e.shiftKey) {
        e.preventDefault();
        const cur = useSettings.getState().settings.editorMode;
        const next = EDITOR_MODES[(EDITOR_MODES.indexOf(cur) + 1) % EDITOR_MODES.length];
        void useSettings.getState().set("editorMode", next);
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === "e") {
        e.preventDefault();
        void exportPdf();
        return;
      }
      if (ctrl && e.shiftKey && key.toLowerCase() === "r" && mode === "live") {
        e.preventDefault();
        if (recording.status === "idle") void recording.start(ui.controller?.state.currentPage ?? 0);
        else setConfirmEnd(true);
        return;
      }
      if (mode === "live" && recording.status !== "idle" && (key === "F1" || key === "F2" || key === "F3")) {
        e.preventDefault();
        void recording.addMarker(key === "F1" ? "important" : key === "F2" ? "confused" : "homework");
        return;
      }
      if (editable) return;
      if (ctrl && key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) void ann.redo();
        else void ann.undo();
        return;
      }
      if (ctrl || e.altKey) return;
      if (mode === "replay") {
        if (key === " " || key.toLowerCase() === "k") {
          e.preventDefault();
          playback.toggle();
          return;
        }
        if (key.toLowerCase() === "j") {
          e.preventDefault();
          playback.skip(-10_000);
          return;
        }
        if (key.toLowerCase() === "l") {
          e.preventDefault();
          playback.skip(10_000);
          return;
        }
      }
      switch (key) {
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          c?.previousPage();
          return;
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          c?.nextPage();
          return;
        case "Delete":
        case "Backspace":
          if (ann.selectedId && !ann.editingId) {
            e.preventDefault();
            void ann.remove(ann.selectedId);
          }
          return;
        case "Escape":
          if (ann.editingId) ann.edit(null);
          else if (ann.popoverId) ann.openPopover(null);
          else if (ann.selectedId) ann.select(null);
          else setTool("select");
          window.getSelection()?.removeAllRanges();
          return;
      }
      const t = TOOL_KEYS[key.toLowerCase()];
      if (t && !e.shiftKey) setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, requestFocus, setTool, toggleRail]);

  // ----- selection toolbar actions -----
  const createHighlightFromSelection = async (text: string, withNote: boolean) => {
    const sel = window.getSelection();
    const c = useSessionUi.getState().controller;
    if (!sel || sel.rangeCount === 0 || !c || !effectiveDeckId) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const pageDiv = node?.closest(".page") as HTMLElement | null;
    const pageNumber = Number(pageDiv?.dataset.pageNumber);
    if (!pageDiv || !Number.isFinite(pageNumber)) return;
    const pageIndex = pageNumber - 1;
    const size = pageSizes[pageIndex];
    if (!size) return;
    const geom: PageGeom = { widthPt: size.width, heightPt: size.height, scale: c.state.scale * CSS_PX_PER_PT, rotation: c.state.rotation };
    const quads = selectionQuads(range, pageDiv, geom);
    if (!quads.length) return;
    const store = useAnnotationStore.getState();
    const id = await store.createHighlight(effectiveDeckId, pageIndex, quads, text, settings.highlightColor);
    sel.removeAllRanges();
    if (withNote) store.openPopover(id);
    return id;
  };

  /** "摘录": highlight the selection and add it to the mind map (docs/SPEC.md 6.5.19). */
  const excerptSelection = async (text: string) => {
    const id = await createHighlightFromSelection(text, false);
    if (!id || !effectiveDeckId) return;
    const row = await getAnnotation(id);
    if (!row) return;
    setDockOpen(true);
    const api = useSessionUi.getState().dockApi;
    if (api) activatePanel(api, "mindmap");
    await useMindmap.getState().addExcerpt(effectiveDeckId, row);
  };

  const selectionActions: SelectionAction["id"][] = atTime ? ["copy", "translate", "addToNotes", "explain"] : ["copy", "highlight", "note", "translate", "addToNotes", "explain", "excerpt"];
  const onSelectionAction = async (id: SelectionAction["id"], text: string) => {
    if (id === "copy") {
      await copyText(text);
      toast("已复制");
      return;
    }
    if (id === "highlight" || id === "note") {
      await createHighlightFromSelection(text, id === "note");
      return;
    }
    if (id === "excerpt") {
      await excerptSelection(text);
      return;
    }
    if (id === "addToNotes") {
      setDockOpen(true);
      const api = useSessionUi.getState().dockApi;
      if (api) activatePanel(api, "notes");
      // Replay shows the snapshot editor by default; the excerpt goes into today's note.
      if (atTime) usePlayback.getState().setNoteViewMode("current");
      try {
        await useNoteEditor.getState().appendToCurrentNote(`> ${text.replace(/\n+/g, " ")}`);
      } catch (e) {
        toast(S.errors.generic(String(e)), "error");
      }
      window.getSelection()?.removeAllRanges();
      return;
    }
    if (id === "translate" || id === "explain") {
      setDockOpen(true);
      const api = useSessionUi.getState().dockApi;
      if (api) activatePanel(api, id);
      useTranslateStore.getState().submit(text, id);
      window.getSelection()?.removeAllRanges();
      return;
    }
    toast(S.panels.comingSoon);
  };

  // ----- top bar menu -----
  const menu = useContextMenu();
  const [renaming, setRenaming] = useState(false);
  const [renamingRecording, setRenamingRecording] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const openMore = (e: React.MouseEvent) =>
    menu.open(e, [
      { label: S.session.rename, icon: "edit", onClick: () => setRenaming(true) },
      { label: "移动到其他课程", icon: "drive_file_move", onClick: () => setMoving(true) },
      { label: S.session.exportMarkdown, icon: "description", onClick: () => void exportMarkdown() },
      { label: S.session.exportPdf, icon: "picture_as_pdf", onClick: () => void exportPdf() },
      { label: S.session.print, icon: "print", onClick: () => void printPdf() },
      ...(mode !== "reading" && session.data
        ? [
          { label: "重命名当前录音", icon: "edit", onClick: () => setRenamingRecording(true) },
          ...(mode === "replay" ? [{ label: S.transcript.redo, icon: "refresh", onClick: () => void redoTranscript() }] : []),
          { label: "删除当前录音", icon: "delete", danger: true, onClick: () => setConfirmDelete(true) },
        ]
        : [{ label: S.session.importNewVersion, icon: "upload_file", onClick: () => toast(S.panels.comingSoon) }]),
    ]);

  const rename = async (value: string) => {
    if (deck.data) await updateDeck(deck.data.id, { title: value });
    setRenaming(false);
  };
  const redoTranscript = async () => {
    if (!session.data) return;
    try {
      await useRetranscribe.getState().start(session.data.id);
      const done = useRetranscribe.getState().jobs[session.data.id];
      if (done?.status === "done") toast(S.transcript.redone(done.segments ?? 0));
    } catch (e) {
      if (e instanceof NoModelError) {
        toast(S.transcript.noModel, "error");
        navigate("/settings/asr");
      } else toast(S.errors.generic(String(e instanceof Error ? e.message : e)), "error");
    }
  };

  const onBack = () => {
    if (mode === "live" && rec.status !== "idle") {
      setConfirmLeave(true);
      return;
    }
    navigate(deck.data ? `/course/${deck.data.course_id}` : "/");
  };
  const [confirmLeave, setConfirmLeave] = useState(false);

  const layerStyle: LayerStyle = {
    highlightColor: settings.highlightColor,
    inkColor: settings.inkColor,
    inkWidth: settings.inkWidth,
    textColor: settings.textColor,
    fontSize: settings.textBoxFontSize,
    borderColor: settings.textBoxBorderColor,
    fillColor: settings.textBoxFillColor,
  };

  const dock = <DockHost key={mode} mode={mode} components={PANEL_COMPONENTS} />;
  const goToPage = (p: number) => useSessionUi.getState().controller?.goToPage(p);
  const visited = useMemo(() => (mode === "replay" && timeline ? new Set(timeline.intervals.map((iv) => iv.pageIndex)) : undefined), [mode, timeline]);

  const rail = effectiveDeckId ? (
    <ThumbnailRail
      deckId={effectiveDeckId}
      doc={doc}
      pageSizes={pageSizes}
      visitedPages={visited}
      width={railWidth}
      onCollapse={() => {
        if (expanded) void setSetting("railCollapsed", true);
        else setRailOverlay(false);
      }}
    />
  ) : null;

  const showBottom = mode !== "reading";
  const recordings = recordingsForDeck(deckSessions.data ?? [], effectiveDeckId);
  const currentRecording = session.data?.id === sessionId ? session.data : null;
  const recordingOptions = currentRecording && !recordings.some((s) => s.id === currentRecording.id)
    ? [currentRecording, ...recordings] : recordings;
  const chooseRecording = async (id: string) => {
    if (rec.status !== "idle" || rec.starting || creating) return;
    try {
      await useNoteEditor.getState().flush();
      pb.unload();
      navigate(`/deck/${effectiveDeckId}?recording=${id || "none"}`, { replace: true });
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const railButton = (
    <button className={`icon-btn ${railOpen ? "active" : ""}`} aria-label={S.session.thumbnails} title={shortcutLabel("Ctrl+Shift+\\")} onClick={toggleRail}>
      <Icon name="left_panel_open" size={20} />
    </button>
  );

  return (
    <TranscriptTranslationProvider sessionId={currentRecording?.deck_id === effectiveDeckId ? currentRecording.id : null}>
    <div className={`session ${layout}`}>
      <header className="session-top" data-tauri-drag-region={isMac ? "" : undefined}>
        {/* macOS: sidebar toggle first, then back — the order of a native toolbar. */}
        {isMac && railButton}
        <button className="icon-btn" aria-label={S.session.back} onClick={onBack}>
          <Icon name="arrow_back" size={isMac ? 20 : 24} />
        </button>
        {!isMac && railButton}
        <div className="grow row session-title-wrap">
          <span className="subtitle session-title" onDoubleClick={() => setRenaming(true)}>
            {title}
          </span>
          {mode === "live" && rec.status !== "idle" && (
            <span className="chip live-chip">
              <span className="live-dot" />
              {S.session.recording}
            </span>
          )}
        </div>
        <span className="sync-dot offline" title="本地模式" aria-label="本地模式" />
        <button className={`icon-btn ${recordingsBarOpen ? "active" : ""}`} aria-label={S.session.recordingsBar} title={S.session.recordingsBar} aria-pressed={recordingsBarOpen}
          onClick={() => void setSetting("recordingsBarCollapsed", recordingsBarOpen)}>
          <Icon name="graphic_eq" size={20} />
        </button>
        <button className={`icon-btn ${dockOpen ? "active" : ""}`} aria-label={S.panels.notes} title={shortcutLabel("Ctrl+\\")} onClick={() => setDockOpen((v) => !v)}>
          <Icon name="right_panel_open" size={20} />
        </button>
        <button className="icon-btn" aria-label="更多" onClick={openMore}>
          <Icon name="more_horiz" size={20} />
        </button>
      </header>

      {recordingsBarOpen && <div className="deck-recordings-bar">
        <Icon name="graphic_eq" size={19} />
        <label htmlFor="deck-recording">此 PDF 的录音</label>
        <select id="deck-recording" className="input" value={currentRecording?.id ?? ""}
          disabled={rec.status !== "idle" || rec.starting || creating}
          onChange={(e) => void chooseRecording(e.target.value)}>
          <option value="">只阅读 PDF</option>
          {recordingOptions.map((s) => <option key={s.id} value={s.id}>
            {s.title} · {fmtDateTime(s.started_at ?? s.created_at)}{s.duration_ms != null ? ` · ${fmtDuration(s.duration_ms)}` : ""}
          </option>)}
        </select>
        {currentRecording && (
          <>
            <button className="icon-btn" aria-label="重命名当前录音" title="重命名当前录音" disabled={rec.status !== "idle" || rec.starting}
              onClick={() => setRenamingRecording(true)}><Icon name="edit" size={18} /></button>
            <button className="icon-btn" aria-label="删除当前录音" title="删除当前录音" disabled={rec.status !== "idle" || rec.starting}
              onClick={() => setConfirmDelete(true)}><Icon name="delete" size={18} /></button>
          </>
        )}
        <button className="btn btn-outlined" disabled={!deck.data || rec.status !== "idle" || rec.starting || creating}
          onClick={() => void startClass()}><Icon name="mic" size={18} />{creating ? "准备中…" : "新增录音"}</button>
      </div>}

      <div className="session-body">
        {expanded && railOpen && (
          <>
            {rail}
            <div className="session-divider rail-divider" onPointerDown={startRailResize} role="separator" aria-orientation="vertical" />
          </>
        )}
        <div className="session-center">
          <SlideToolbar
            onStartClass={kind === "deck" ? startClass : undefined}
            onSearch={() => {
              setDockOpen(true);
              requestFocus("search");
            }}
            onExportPdf={() => void exportPdf()}
            onExportMarkdown={() => void exportMarkdown()}
            onPrint={() => void printPdf()}
          />
          {mode === "live" && rec.status === "idle" && !bannerDismissed && (
            <div className="prep-banner">
              <Icon name="info" size={20} className="text2" />
              <span className="body-small grow">{S.session.prepareBanner}</span>
              <button className="icon-btn" aria-label={S.common.close} onClick={() => setBannerDismissed(true)}>
                <Icon name="close" size={18} />
              </button>
            </div>
          )}
          {mode === "live" && rec.interrupted && (
            <div className="interrupt-banner">
              <Icon name="mic_off" size={20} style={{ color: "var(--record)" }} />
              <span className="body-small grow">录音被打断，点继续</span>
              <button className="btn btn-filled btn-record" onClick={() => void rec.resume()}>
                {S.session.continueRecording}
              </button>
            </div>
          )}
          <div className="session-viewer">
            <PdfViewer
              doc={doc}
              error={docError ?? (deck.data && deck.data.status !== "ready" ? (deck.data.error_message ?? S.course.statusImporting) : null)}
              initialPage={session.data?.initial_page_index ?? 0}
              selectionActions={selectionActions}
              onSelectionAction={onSelectionAction}
              autoAction={tool === "highlight" && !atTime ? "highlight" : null}
            >
              {effectiveDeckId && (
                <AnnotationLayer deckId={effectiveDeckId} pageSizes={pageSizes} tool={tool} style={layerStyle} onOpenPage={goToPage} readOnly={atTime} overrideRows={replayRows} />
              )}
            </PdfViewer>
            {!expanded && railOpen && (
              <>
                <div className="rail-backdrop" onClick={() => setRailOverlay(false)} />
                <div className="rail-overlay">{rail}</div>
              </>
            )}
          </div>
        </div>
        {expanded && dockOpen && (
          <>
            <div className="session-divider" onPointerDown={startResize} role="separator" aria-orientation="vertical" />
            <aside className="session-dock" style={{ width: dockWidth }}>
              {dock}
            </aside>
          </>
        )}
      </div>
      {!expanded && dockOpen && <div className="session-dock-bottom">{dock}</div>}

      {showBottom && (
        <div className="session-bottom">
          {mode === "live" ? (
            <TransportBarLive onEnded={() => setBannerDismissed(true)} />
          ) : (
            <TransportBarReplay timeline={timeline} onJumpTo={jumpTo} />
          )}
          <TimelineScrubber
            timeline={timeline}
            durationMs={mode === "live" ? rec.tMs : (session.data?.duration_ms ?? 0)}
            playheadMs={mode === "live" ? rec.tMs : pb.positionMs}
            mode={mode === "live" ? "live" : "replay"}
            onSeek={mode === "replay" ? jumpTo : undefined}
          />
        </div>
      )}

      {menu.element}
      <PromptDialog open={renaming} title={S.session.rename} initial={title} onClose={() => setRenaming(false)} onSubmit={rename} />
      <PromptDialog open={renamingRecording} title="重命名当前录音" initial={currentRecording?.title ?? ""}
        onClose={() => setRenamingRecording(false)} onSubmit={async (value) => {
          if (currentRecording) await updateSession(currentRecording.id, { title: value });
          setRenamingRecording(false);
        }} />
      {moving && deck.data && <MoveDeckDialog deck={deck.data} onClose={() => setMoving(false)} />}
      <ConfirmDialog
        open={confirmDelete}
        title="删除当前录音"
        body="会同时删除这节课的录音、转写和总结。"
        confirmLabel={S.library.delete}
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const r = useRecording.getState();
          if (session.data && r.sessionId === session.data.id && r.status !== "idle") await r.stop();
          if (session.data) await deleteSessionWithFiles(session.data);
          setConfirmDelete(false);
          navigate(`/deck/${effectiveDeckId}?recording=none`, { replace: true });
        }}
      />
      <ConfirmDialog
        open={recordingElsewhere}
        title={S.session.recordingElsewhereTitle}
        body={S.session.recordingElsewhereBody}
        confirmLabel={S.session.backToClass}
        cancelLabel={S.session.endThatClass}
        onCancel={() => void useRecording.getState().stop()}
        onConfirm={() => navigate(`/session/${rec.sessionId}`)}
      />
      <ConfirmDialog
        open={confirmLeave}
        title={S.session.leaveTitle}
        body={S.session.leaveBody}
        confirmLabel={S.session.endClass}
        cancelLabel={S.session.continueRecording}
        danger
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          setConfirmEnd(true);
        }}
      />
      <ConfirmDialog
        open={confirmEnd}
        title={S.session.endTitle}
        body={S.session.endBody}
        confirmLabel={S.session.end}
        cancelLabel={S.session.continueRecording}
        danger
        onCancel={() => setConfirmEnd(false)}
        onConfirm={async () => {
          setConfirmEnd(false);
          await useRecording.getState().stop();
        }}
      />
    </div>
    </TranscriptTranslationProvider>
  );
}
