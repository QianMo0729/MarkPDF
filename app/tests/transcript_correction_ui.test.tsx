import type { IDockviewPanelProps } from "dockview-react";
import type { TranscriptSegmentRow } from "../src/data/db/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  mode: "live", sessionId: "recording-a", rows: [] as TranscriptSegmentRow[],
  settings: { localMode: true, transcriptTranslationEnabled: true, transcriptCorrectionEnabled: false, translationMode: "local", translateTarget: "zh" },
  set: vi.fn(), seek: vi.fn(), recordingStop: vi.fn(), navigate: vi.fn(),
  translation: { activeId: null as string | null, pendingCount: 0, progress: "", error: null as { segmentId: string; message: string } | null, retry: vi.fn(), stop: vi.fn() },
  correction: { activeId: null as string | null, pendingCount: 0, progress: "", waitingForContext: false, error: null as { segmentId: string; message: string } | null, retry: vi.fn(), stop: vi.fn() },
}));
vi.mock("../src/data/db/client", () => ({ select: vi.fn() }));
vi.mock("../src/data/db/live", () => ({ useLiveQuery: () => ({ data: null }) }));
vi.mock("../src/features/session/sessionStore", () => ({ useSessionUi: (select: (s: unknown) => unknown) => select(data) }));
vi.mock("../src/stores/settings", () => ({ useSettings: (select: (s: unknown) => unknown) => select({ settings: data.settings, set: data.set }) }));
vi.mock("../src/features/session/controllers/recording", () => ({ useRecording: () => ({ sessionId: data.sessionId, partial: "", asr: "on", tMs: 2000, stop: data.recordingStop }) }));
vi.mock("../src/features/session/controllers/playback", () => ({ usePlayback: () => ({ positionMs: 0, seek: data.seek }) }));
vi.mock("../src/features/session/controllers/TranscriptTranslationContext", () => ({
  useSharedTranscriptTranslation: () => ({ sessionId: data.sessionId, ready: true, rows: data.rows, translation: data.translation, correction: data.correction }),
}));
vi.mock("../src/features/session/controllers/useTranscriptTranslation", () => ({ useTranscriptTranslation: () => data.translation }));
vi.mock("../src/features/session/controllers/useTranscriptCorrection", () => ({ useTranscriptCorrection: () => data.correction }));
vi.mock("../src/features/session/widgets/TransportBarLive", () => ({ asrChipFor: () => ({ label: "设备转写", cls: "asr-on" }) }));
vi.mock("react-router", () => ({ useNavigate: () => data.navigate }));

import { TranscriptPanel } from "../src/features/session/panels/TranscriptPanel";

const props = { api: { id: "transcript" } } as IDockviewPanelProps;
const row = (changes: Partial<TranscriptSegmentRow> = {}): TranscriptSegmentRow => ({
  id: "sentence-a", session_id: "recording-a", source: "device", t0_ms: 0, t1_ms: 2000,
  text: "I want to go too.", original_text: "I want two go two.", translation: null,
  lang: "en", page_index: 0, created_at: "", updated_at: "", dirty: 1, ...changes,
});

beforeEach(() => {
  data.mode = "live";
  data.rows = [];
  data.settings.transcriptCorrectionEnabled = false;
  data.settings.transcriptTranslationEnabled = true;
  data.set.mockReset().mockResolvedValue(undefined);
  data.seek.mockReset(); data.recordingStop.mockReset(); data.navigate.mockReset();
  for (const queue of [data.translation, data.correction]) {
    queue.activeId = null; queue.pendingCount = 0; queue.progress = ""; queue.error = null;
    queue.retry.mockReset(); queue.stop.mockReset();
  }
  data.correction.waitingForContext = false;
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("context correction controls and source text", () => {
  it("offers an independent opt-in switch explaining configured AI and retained originals", () => {
    render(<TranscriptPanel {...props} />);
    const toggle = screen.getByRole("switch", { name: "上下文纠错" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle.getAttribute("title")).toMatch(/AI.*原始转写/);
    fireEvent.click(toggle);
    expect(data.set).toHaveBeenCalledWith("transcriptCorrectionEnabled", true);
    expect(data.translation.stop).not.toHaveBeenCalled();
    expect(data.recordingStop).not.toHaveBeenCalled();
  });

  it("stops correction immediately before persisting off without stopping translation or recording", () => {
    data.settings.transcriptCorrectionEnabled = true;
    render(<TranscriptPanel {...props} />);
    fireEvent.click(screen.getByRole("switch", { name: "上下文纠错" }));
    expect(data.correction.stop).toHaveBeenCalledTimes(1);
    expect(data.correction.stop.mock.invocationCallOrder[0]).toBeLessThan(data.set.mock.invocationCallOrder[0]);
    expect(data.set).toHaveBeenCalledWith("transcriptCorrectionEnabled", false);
    expect(data.translation.stop).not.toHaveBeenCalled();
    expect(data.recordingStop).not.toHaveBeenCalled();
  });

  it("distinguishes active correction, waiting for a following sentence, and retryable failures", () => {
    data.settings.transcriptCorrectionEnabled = true;
    data.correction.activeId = "sentence-a";
    const view = render(<TranscriptPanel {...props} />);
    expect(screen.getByText(/正在纠错/)).toBeInTheDocument();
    data.correction.activeId = null;
    data.correction.waitingForContext = true;
    view.rerender(<TranscriptPanel {...props} />);
    expect(screen.getByText(/等待后文/)).toBeInTheDocument();
    data.correction.error = { segmentId: "sentence-a", message: "AI 服务未配置" };
    view.rerender(<TranscriptPanel {...props} />);
    expect(screen.getByText(/纠错已暂停：AI 服务未配置/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试纠错" }));
    expect(data.correction.retry).toHaveBeenCalledTimes(1);
    expect(data.translation.retry).not.toHaveBeenCalled();
  });

  it("reveals the original through a separate keyboard-accessible button without seeking playback", () => {
    data.mode = "replay";
    data.rows = [row()];
    render(<TranscriptPanel {...props} />);
    expect(screen.getByText("已纠错")).toBeInTheDocument();
    const disclosure = screen.getByRole("button", { name: /查看原始转写/ });
    expect(disclosure.parentElement?.closest("button")).toBeNull();
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(disclosure.getAttribute("aria-controls")!)).toHaveTextContent("I want two go two.");
    expect(data.seek).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /I want to go too/ }));
    expect(data.seek).toHaveBeenCalledWith(0);
  });

  it("finds original wording after correction and automatically shows the matching source text", () => {
    data.rows = [row()];
    render(<TranscriptPanel {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索转写" }), { target: { value: "two" } });
    expect(screen.getByText("I want to go too.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /收起原始转写/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("two", { selector: "mark" })).toBeInTheDocument();
    expect(data.seek).not.toHaveBeenCalled();
  });

  it("marks only actually changed sentences, including after correction is switched off", () => {
    data.rows = [row({ original_text: "I want to go too." }), row({ id: "unchanged", original_text: null })];
    const view = render(<TranscriptPanel {...props} />);
    expect(screen.queryByText("已纠错")).not.toBeInTheDocument();
    data.rows = [row()];
    view.rerender(<TranscriptPanel {...props} />);
    expect(screen.getByText("已纠错")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看原始转写/ })).toBeInTheDocument();
  });
});
