import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SlideToolbar } from "../src/features/session/widgets/SlideToolbar";
import { useSessionUi } from "../src/features/session/sessionStore";

const rec = vi.hoisted(() => ({status: "idle", starting: false, start: vi.fn(), pause: vi.fn(), resume: vi.fn()}));
vi.mock("../src/features/session/controllers/recording", () => ({useRecording: () => rec}));

beforeEach(() => {
  vi.clearAllMocks();
  rec.status = "idle";
  rec.starting = false;
  useSessionUi.setState({mode: "reading", controller: null, tool: "select"});
});
afterEach(cleanup);

describe("record button stays available beside annotation tools", () => {
  it.each(["reading", "replay"] as const)("routes a %s click through the new/continue choice", (mode) => {
    useSessionUi.setState({mode});
    const choose = vi.fn();
    const {container} = render(<SlideToolbar onStartClass={choose} onSearch={vi.fn()} onExportPdf={vi.fn()} onExportMarkdown={vi.fn()} onPrint={vi.fn()} />);
    const button = container.querySelector(".record-btn")!;
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(choose).toHaveBeenCalledOnce();
    expect(rec.start).not.toHaveBeenCalled();
    expect(rec.pause).not.toHaveBeenCalled();
  });

  it("keeps the replay record button visible but disabled while another recording owns the microphone", () => {
    useSessionUi.setState({mode: "replay"});
    rec.status = "recording";
    const choose = vi.fn();
    const {container} = render(<SlideToolbar recordingDisabled onStartClass={choose} onSearch={vi.fn()} onExportPdf={vi.fn()} onExportMarkdown={vi.fn()} onPrint={vi.fn()} />);
    const button = container.querySelector(".record-btn")!;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(choose).not.toHaveBeenCalled();
    expect(rec.pause).not.toHaveBeenCalled();
  });

  it("continues to pause the active recording in live mode", () => {
    useSessionUi.setState({mode: "live"});
    rec.status = "recording";
    const choose = vi.fn();
    render(<SlideToolbar onStartClass={choose} onSearch={vi.fn()} onExportPdf={vi.fn()} onExportMarkdown={vi.fn()} onPrint={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "暂停录音"}));
    expect(rec.pause).toHaveBeenCalledOnce();
    expect(choose).not.toHaveBeenCalled();
  });
});
