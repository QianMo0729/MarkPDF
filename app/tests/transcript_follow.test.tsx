import type { IDockviewPanelProps } from "dockview-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  mode: "live",
  sessionId: "session-a",
  rec: { sessionId: "session-a", partial: "The lecturer is still speaking", tMs: 1000, asr: "on" },
  rows: [] as { id: string; session_id: string; t0_ms: number; t1_ms: number; text: string; translation: string | null; page_index: number | null; source: string }[],
  height: 900,
  positionMs: 0,
}));

vi.mock("../src/data/db/client", () => ({ select: vi.fn() }));
vi.mock("../src/data/db/live", () => ({ useLiveQuery: () => ({ data: { sessionId: data.sessionId, rows: data.rows } }) }));
vi.mock("../src/features/session/controllers/recording", () => ({ useRecording: () => data.rec }));
vi.mock("../src/features/session/controllers/playback", () => ({ usePlayback: () => ({ positionMs: data.positionMs, seek: vi.fn() }) }));
vi.mock("../src/features/session/sessionStore", () => ({ useSessionUi: (select: (s: typeof data) => unknown) => select(data) }));
vi.mock("../src/stores/settings", () => ({ useSettings: (select: (s: { settings: { localMode: boolean } }) => unknown) => select({ settings: { localMode: true } }) }));
vi.mock("../src/features/session/widgets/TransportBarLive", () => ({ asrChipFor: () => ({ label: "设备转写", cls: "asr-on" }) }));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

import { TranscriptPanel } from "../src/features/session/panels/TranscriptPanel";

const props = { api: { id: "transcript" } } as IDockviewPanelProps;
const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
  this.scrollTop = Math.max(0, Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight));
});

describe("transcript following", () => {
  beforeEach(() => {
    data.mode = "live";
    data.sessionId = "session-a";
    data.rec.partial = "The lecturer is still speaking";
    data.rec.sessionId = "session-a";
    data.rows = [];
    data.height = 900;
    data.positionMs = 0;
    scrollTo.mockClear();
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => data.height);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(500);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: scrollTo, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("follows a growing partial sentence even before any finalized segment exists", () => {
    const view = render(<TranscriptPanel {...props} />);
    const list = screen.getByLabelText("转写内容");
    expect(list.scrollTop).toBe(700);
    expect(screen.queryByText("开始录音后这里显示实时转写")).not.toBeInTheDocument();
    data.rec.partial += " and the sentence wraps onto another line";
    data.height = 1000;
    view.rerender(<TranscriptPanel {...props} />);
    expect(list.scrollTop).toBe(800);
    // The browser's scroll event from our own scroll must not disable following.
    fireEvent.scroll(list);
    expect(screen.queryByRole("button", { name: "回到最新" })).not.toBeInTheDocument();
  });

  it("keeps the user's reading position during partial/final updates and resumes on request", () => {
    const view = render(<TranscriptPanel {...props} />);
    const list = screen.getByLabelText("转写内容");
    fireEvent.wheel(list, { deltaY: -100 });
    list.scrollTop = 300;
    fireEvent.scroll(list);
    const calls = scrollTo.mock.calls.length;
    data.rec.partial = "A new unfinished sentence";
    data.rows = [{ id: "first", session_id: "session-a", t0_ms: 0, t1_ms: 1000, text: "The finalized sentence", translation: "译文", page_index: 0, source: "device" }];
    data.height = 1100;
    view.rerender(<TranscriptPanel {...props} />);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
    expect(list.scrollTop).toBe(300);
    fireEvent.click(screen.getByRole("button", { name: "回到最新" }));
    expect(list.scrollTop).toBe(900);
    expect(screen.queryByRole("button", { name: "回到最新" })).not.toBeInTheDocument();
  });

  it("pauses for scrollbar and keyboard reading, including a partial-only transcript", () => {
    const view = render(<TranscriptPanel {...props} />);
    const list = screen.getByLabelText("转写内容");
    list.scrollTop = 200;
    fireEvent.scroll(list);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回到最新" }));
    fireEvent.keyDown(list, { key: "PageUp" });
    const calls = scrollTo.mock.calls.length;
    data.rec.partial += " more speech";
    view.rerender(<TranscriptPanel {...props} />);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeInTheDocument();
  });

  it("follows the current replay row and resets following when changing recordings", () => {
    data.mode = "replay";
    data.rows = [{ id: "first", session_id: "session-a", t0_ms: 0, t1_ms: 1000, text: "Recorded speech", translation: null, page_index: null, source: "device" }];
    const view = render(<TranscriptPanel {...props} />);
    const list = screen.getByLabelText("转写内容");
    expect(list.scrollTop).toBe(430);
    fireEvent.wheel(list, { deltaY: 100 });
    expect(screen.getByRole("button", { name: "回到当前" })).toBeInTheDocument();
    data.sessionId = "session-b";
    view.rerender(<TranscriptPanel {...props} />);
    expect(screen.queryByRole("button", { name: "回到当前" })).not.toBeInTheDocument();
    expect(screen.queryByText("Recorded speech")).not.toBeInTheDocument();
  });

  it("never shows unfinished speech belonging to another PDF's recording", () => {
    data.rec.sessionId = "recording-in-another-pdf";
    render(<TranscriptPanel {...props} />);
    expect(screen.queryByText("The lecturer is still speaking")).not.toBeInTheDocument();
  });
});
