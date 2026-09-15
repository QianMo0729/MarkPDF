import { useEffect, useState } from "react";
import { create } from "zustand";
import type { DockviewApi } from "dockview-react";
import type { PdfViewerController, ViewerState } from "../../pdf/viewerController";

export type Tool = "select" | "highlight" | "draw" | "text" | "erase";

/** UI state shared by the session screen, its toolbar, rail and dock panels. */
export type SessionMode = "reading" | "live" | "replay";

interface SessionUiStore {
  deckId: string | null;
  sessionId: string | null;
  mode: SessionMode;
  controller: PdfViewerController | null;
  dockApi: DockviewApi | null;
  tool: Tool;
  /** Text currently selected in the PDF (for translate / notes panels). */
  selectionText: string;
  /** Request focus of a panel's primary input (e.g. Ctrl+F -> search box). */
  focusRequest: { panel: string; nonce: number } | null;
  setDeckId: (id: string | null) => void;
  setSessionId: (id: string | null) => void;
  setMode: (m: SessionMode) => void;
  setController: (c: PdfViewerController | null) => void;
  setDockApi: (api: DockviewApi | null) => void;
  setTool: (t: Tool) => void;
  setSelectionText: (t: string) => void;
  requestFocus: (panel: string) => void;
}

export const useSessionUi = create<SessionUiStore>((set) => ({
  deckId: null,
  sessionId: null,
  mode: "reading",
  controller: null,
  dockApi: null,
  tool: "select",
  selectionText: "",
  focusRequest: null,
  setDeckId: (deckId) => set({ deckId }),
  setSessionId: (sessionId) => set({ sessionId }),
  setMode: (mode) => set({ mode }),
  setController: (controller) => set({ controller }),
  setDockApi: (dockApi) => set({ dockApi }),
  setTool: (tool) => set({ tool }),
  setSelectionText: (selectionText) => set({ selectionText }),
  requestFocus: (panel) => set({ focusRequest: { panel, nonce: Date.now() } }),
}));

const EMPTY: ViewerState = {
  currentPage: 0,
  pageCount: 0,
  scale: 1,
  scaleValue: "page-width",
  rotation: 0,
  viewMode: "single",
  findTotal: 0,
  findCurrent: 0,
  pagesReady: 0,
  canGoBack: false,
  canGoForward: false,
};

/** Live viewer state (page, zoom, rotation...) for any component. */
export function useViewerState(): ViewerState {
  const controller = useSessionUi((s) => s.controller);
  const [state, setState] = useState<ViewerState>(controller?.state ?? EMPTY);
  useEffect(() => {
    if (!controller) {
      setState(EMPTY);
      return;
    }
    return controller.subscribe(setState);
  }, [controller]);
  return state;
}
