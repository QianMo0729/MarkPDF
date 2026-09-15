import { AnnotationEditorType, AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { PdfNavigationHistory, type PdfPosition } from "./navigationHistory";

export type ViewMode = "single" | "continuous";

export interface ViewerState {
  /** 0-based current page (docs/SPEC.md 5.4: the page pdf.js reports as most visible). */
  currentPage: number;
  pageCount: number;
  scale: number;
  /** "page-width" | "page-fit" | "auto" | numeric string */
  scaleValue: string;
  rotation: number;
  viewMode: ViewMode;
  findTotal: number;
  findCurrent: number;
  /** Incremented whenever pdf.js (re)creates its page elements. */
  pagesReady: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface FindOptions {
  query: string;
  again?: boolean;
  previous?: boolean;
  highlightAll?: boolean;
}

type Listener = (state: ViewerState) => void;

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

/** pdf.js search and hash/coordinate links can bypass goToDestination. */
class NavigationLinkService extends PDFLinkService {
  beforeJump = () => {};

  override get page() { return super.page; }
  override set page(value: number) {
    if (this.pdfDocument && Number.isInteger(value) && value > 0 && value <= this.pagesCount) this.beforeJump();
    super.page = value;
  }

  override goToXY(pageNumber: number, x: number, y: number, options?: object) {
    if (this.pdfDocument && pageNumber > 0 && pageNumber <= this.pagesCount) this.beforeJump();
    super.goToXY(pageNumber, x, y, options);
  }

  override setHash(hash: string) {
    if (this.pdfDocument && /(?:^|&)zoom=/.test(hash)) this.beforeJump();
    super.setHash(hash);
  }
}

/**
 * Thin, typed wrapper around pdf.js's PDFViewer for the session screen. All UI
 * (toolbar, rail, panels, shortcuts) talks to this class, never to pdf.js directly.
 */
export class PdfViewerController {
  readonly eventBus = new EventBus();
  readonly linkService: PDFLinkService;
  readonly findController: PDFFindController;
  readonly viewer: PDFViewer;
  private listeners = new Set<Listener>();
  private initialScaleValue = "page-width";
  private initialPage = 0;
  private disposed = false;
  private readonly history = new PdfNavigationHistory();
  private restoringPosition = false;
  /** Aborting it detaches pdf.js's document-level listeners and ResizeObserver (audit F6). */
  private readonly abort = new AbortController();

  state: ViewerState = {
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

  constructor(container: HTMLDivElement, viewerEl: HTMLDivElement, options: { viewMode: ViewMode; scaleValue: string }) {
    const linkService = new NavigationLinkService({ eventBus: this.eventBus });
    this.linkService = linkService;
    linkService.beforeJump = () => this.rememberPosition();
    // Use document-local history: PDFHistory writes browser state and conflicts
    // with the React Router history used to return to courses and the library.
    this.linkService.setHistory({
      pushCurrentPosition: () => this.rememberPosition(),
      push: () => {},
      pushPage: () => {},
      back: () => this.goBack(),
      forward: () => this.goForward(),
    });
    this.findController = new PDFFindController({
      eventBus: this.eventBus,
      linkService: this.linkService,
      updateMatchesCountOnProgress: true,
    });
    this.viewer = new PDFViewer({
      container,
      viewer: viewerEl,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      textLayerMode: 1,
      annotationMode: AnnotationMode.ENABLE,
      annotationEditorMode: AnnotationEditorType.DISABLE,
      removePageBorders: true,
      // pdf.js 6 honours abortSignal (web/pdf_viewer.mjs) though its .d.ts does not list it.
      ...({ abortSignal: this.abort.signal } as unknown as Partial<ConstructorParameters<typeof PDFViewer>[0]>),
    });
    this.linkService.setViewer(this.viewer);
    this.initialScaleValue = options.scaleValue;
    this.state.viewMode = options.viewMode;
    this.state.scaleValue = options.scaleValue;

    this.eventBus.on("pagesinit", () => {
      this.viewer.scrollMode = this.state.viewMode === "single" ? ScrollMode.PAGE : ScrollMode.VERTICAL;
      this.viewer.currentScaleValue = this.initialScaleValue;
      if (this.initialPage > 0) this.viewer.currentPageNumber = this.initialPage + 1;
      this.patch({ pageCount: this.viewer.pagesCount, currentPage: this.viewer.currentPageNumber - 1, pagesReady: this.state.pagesReady + 1 });
    });
    this.eventBus.on("pagechanging", (e: { pageNumber: number }) => {
      this.patch({ currentPage: e.pageNumber - 1 });
    });
    this.eventBus.on("scalechanging", (e: { scale: number; presetValue?: string }) => {
      this.patch({ scale: e.scale, scaleValue: e.presetValue ?? String(e.scale) });
    });
    this.eventBus.on("rotationchanging", (e: { pagesRotation: number }) => {
      this.patch({ rotation: e.pagesRotation });
    });
    this.eventBus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) => {
      this.patch({ findTotal: e.matchesCount.total, findCurrent: e.matchesCount.current });
    });
    this.eventBus.on("updatefindcontrolstate", (e: { matchesCount: { current: number; total: number } }) => {
      this.patch({ findTotal: e.matchesCount.total, findCurrent: e.matchesCount.current });
    });
  }

  private patch(partial: Partial<ViewerState>) {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setDocument(doc: PDFDocumentProxy, initialPage = 0) {
    this.history.clear();
    this.publishHistory();
    this.initialPage = initialPage;
    this.viewer.setDocument(doc);
    this.linkService.setDocument(doc, null);
  }

  /** Called by the component when the container is resized. */
  refreshLayout() {
    if (this.disposed || !this.viewer.pdfDocument) return;
    const value = this.state.scaleValue;
    if (value === "page-width" || value === "page-fit" || value === "auto") this.viewer.currentScaleValue = value;
    else this.viewer.update();
  }

  goToPage(index0: number, { recordHistory = true }: { recordHistory?: boolean } = {}) {
    if (!Number.isFinite(index0)) return;
    if (!this.viewer.pdfDocument) {
      this.initialPage = index0;
      return;
    }
    const clamped = Math.max(0, Math.min(this.viewer.pagesCount - 1, Math.trunc(index0)));
    if (recordHistory && clamped !== this.state.currentPage) this.rememberPosition();
    this.viewer.currentPageNumber = clamped + 1;
  }

  private capturePosition(): PdfPosition | null {
    if (!this.viewer.pdfDocument || !this.viewer.pagesCount) return null;
    const page = this.viewer.currentPageNumber - 1;
    const view = this.viewer.getPageView(page);
    if (!view) return null;
    const host = this.viewer.container;
    const hostRect = host.getBoundingClientRect();
    const pageRect = view.div.getBoundingClientRect();
    const [left, top] = view.getPagePoint(hostRect.left + host.clientLeft - pageRect.left, hostRect.top + host.clientTop - pageRect.top);
    return { page, left, top, scaleValue: this.state.scaleValue, rotation: this.state.rotation, viewMode: this.state.viewMode };
  }

  private rememberPosition() {
    if (this.restoringPosition || this.disposed) return;
    const position = this.capturePosition();
    if (!position) return;
    this.history.remember(position);
    this.publishHistory();
  }

  private publishHistory() {
    this.patch({ canGoBack: this.history.canGoBack, canGoForward: this.history.canGoForward });
  }

  goBack() { this.navigateHistory("back"); }
  goForward() { this.navigateHistory("forward"); }

  private navigateHistory(direction: "back" | "forward") {
    const current = this.capturePosition();
    if (!current) return;
    const target = this.history[direction](current);
    this.publishHistory();
    if (!target) return;
    // A text layer still rendering a search match can otherwise scroll us back
    // to that match after Back has already restored the previous page.
    this.clearFind();
    this.restoringPosition = true;
    try {
      this.setViewMode(target.viewMode);
      this.viewer.pagesRotation = target.rotation;
      this.viewer.currentScaleValue = target.scaleValue;
      this.viewer.scrollPageIntoView({
        pageNumber: target.page + 1,
        destArray: [null, { name: "XYZ" }, target.left, target.top, null],
        allowNegativeOffset: true,
        ignoreDestinationZoom: true,
      });
    } finally {
      this.restoringPosition = false;
    }
  }
  nextPage() {
    this.viewer.nextPage();
  }
  previousPage() {
    this.viewer.previousPage();
  }

  setScaleValue(value: string) {
    this.viewer.currentScaleValue = value;
  }
  /** origin: [x, y] relative to the scroll container, used to keep the point under the cursor stable. */
  zoomIn(origin?: [number, number], factor = 1.1) {
    if (this.state.scale >= MAX_SCALE) return;
    this.viewer.updateScale({ scaleFactor: factor, origin, drawingDelay: 400 });
  }
  zoomOut(origin?: [number, number], factor = 1.1) {
    if (this.state.scale <= MIN_SCALE) return;
    this.viewer.updateScale({ scaleFactor: 1 / factor, origin, drawingDelay: 400 });
  }
  rotate(deltaDeg: number) {
    this.viewer.pagesRotation = ((this.viewer.pagesRotation + deltaDeg) % 360 + 360) % 360;
  }
  setViewMode(mode: ViewMode) {
    this.patch({ viewMode: mode });
    if (!this.viewer.pdfDocument) return;
    const page = this.viewer.currentPageNumber;
    this.viewer.scrollMode = mode === "single" ? ScrollMode.PAGE : ScrollMode.VERTICAL;
    this.viewer.currentPageNumber = page;
  }

  goToDestination(dest: string | unknown[] | null) {
    if (dest) this.linkService.goToDestination(dest as never);
  }

  find({ query, again, previous, highlightAll = true }: FindOptions) {
    this.eventBus.dispatch("find", {
      source: this,
      type: again ? "again" : "",
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll,
      findPrevious: !!previous,
      matchDiacritics: false,
    });
  }
  clearFind() {
    this.eventBus.dispatch("findbarclose", { source: this });
    this.patch({ findTotal: 0, findCurrent: 0 });
  }

  /** Page element for overlays (annotation layer etc.), 0-based. */
  pageElement(index0: number): HTMLElement | null {
    const view = this.viewer.getPageView(index0) as { div?: HTMLElement } | undefined;
    return view?.div ?? null;
  }

  destroy() {
    this.disposed = true;
    this.listeners.clear();
    try {
      // setDocument(null) runs pdf.js's _resetView: page views, canvases and the
      // document "copy" listener go with it; the abort signal drops the rest.
      this.viewer.setDocument(null as unknown as PDFDocumentProxy);
      this.linkService.setDocument(null, null);
      this.findController.setDocument(null as unknown as PDFDocumentProxy);
    } catch {
      /* ignore */
    }
    this.abort.abort();
  }
}
