import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegmentRow } from "../src/data/db/schema";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(), translate: vi.fn(), saveCorrection: vi.fn(), saveTranslation: vi.fn(),
  settings: { transcriptCorrectionEnabled: true, transcriptTranslationEnabled: false, translateTarget: "zh", translationMode: "local" },
  result: { sessionId: "recording-a", rows: [] as TranscriptSegmentRow[] },
}));
vi.mock("../src/stores/settings", () => ({ useSettings: (selector: (value: unknown) => unknown) => selector({ settings: mocks.settings }) }));
vi.mock("../src/data/db/client", () => ({ select: vi.fn(), selectOne: async (_sql: string, params: string[]) => mocks.result.rows.find((row) => row.id === params[0] && row.session_id === params[1]) ?? null }));
vi.mock("../src/data/db/live", () => ({ useLiveQuery: () => ({ data: mocks.result }) }));
vi.mock("../src/data/db/repos/transcripts", () => ({ saveSegmentCorrection: mocks.saveCorrection, saveSegmentTranslation: mocks.saveTranslation }));
vi.mock("../src/data/api/llm", () => ({ chat: mocks.chat }));
vi.mock("../src/features/session/controllers/translate", () => ({ runTextAction: mocks.translate }));
import { TranscriptTranslationProvider, useSharedTranscriptTranslation } from "../src/features/session/controllers/TranscriptTranslationContext";

function row(id: string, index = 0, sessionId = "recording-a"): TranscriptSegmentRow {
  return { id, session_id: sessionId, source: "device", t0_ms: index * 1000, t1_ms: (index + 1) * 1000, text: id === "a" ? "I like it two." : "I mean also, not the number.", translation: null, lang: "en", page_index: 0, created_at: "", updated_at: "", dirty: 1 };
}
function Probe({ mode }: { mode: string }) {
  const shared = useSharedTranscriptTranslation();
  return <div>{mode}: {shared?.correction.pendingCount}</div>;
}
function View({ mode = "live", sessionId = "recording-a" }: { mode?: string; sessionId?: string }) {
  return <TranscriptTranslationProvider sessionId={sessionId}><Probe key={mode} mode={mode} /></TranscriptTranslationProvider>;
}
const edits = '{"edits":[{"from":"two","to":"too","occurrence":1}]}';

beforeEach(() => {
  mocks.chat.mockReset().mockResolvedValue('{"edits":[]}');
  mocks.translate.mockReset().mockResolvedValue("译文");
  mocks.saveCorrection.mockReset().mockResolvedValue(undefined);
  mocks.saveTranslation.mockReset().mockResolvedValue(undefined);
  mocks.settings.transcriptCorrectionEnabled = true;
  mocks.settings.transcriptTranslationEnabled = false;
  mocks.result = { sessionId: "recording-a", rows: [] };
});
afterEach(cleanup);

describe("recording-owned correction lifecycle", () => {
  it("retains initial and following-context jobs when live/replay rebuilds the panel", async () => {
    let finish!: (value: string) => void;
    mocks.chat.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const view = render(<View />);
    mocks.result = { sessionId: "recording-a", rows: [row("a"), row("b", 1)] };
    view.rerender(<View />);
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(1));
    const signal = mocks.chat.mock.calls[0][1].signal;
    view.rerender(<View mode="replay" />);
    expect(signal.aborted).toBe(false);
    expect(screen.getByText("replay: 2")).toBeInTheDocument();
    await act(async () => { finish('{"edits":[]}'); });
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(3));
    const inputs = mocks.chat.mock.calls.map(([messages]) => JSON.parse(messages[1].content));
    expect(inputs.map((input) => input.current_sentence)).toEqual([row("a").text, row("b").text, row("a").text]);
    expect(inputs[2].next_sentence).toBe(row("b").text);
    view.rerender(<View mode="replay" />);
    expect(mocks.chat).toHaveBeenCalledTimes(3);
  });

  it("rejects stale recording data and late old-recording corrections", async () => {
    let finish!: (value: string) => void;
    mocks.chat.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const view = render(<View />);
    mocks.result = { sessionId: "recording-a", rows: [row("a")] };
    view.rerender(<View />);
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(1));
    const signal = mocks.chat.mock.calls[0][1].signal;
    view.rerender(<View sessionId="recording-b" />);
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(edits); });
    expect(mocks.saveCorrection).not.toHaveBeenCalled();
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    mocks.result = { sessionId: "recording-b", rows: [row("b", 0, "recording-b")] };
    view.rerender(<View sessionId="recording-b" />);
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(2));
  });

  it("disabling correction aborts it without interrupting an active translation", async () => {
    let finishCorrection!: (value: string) => void, finishTranslation!: (value: string) => void;
    mocks.chat.mockImplementationOnce(() => new Promise<string>((resolve) => { finishCorrection = resolve; }));
    mocks.translate.mockImplementationOnce(() => new Promise<string>((resolve) => { finishTranslation = resolve; }));
    mocks.settings.transcriptTranslationEnabled = true;
    const view = render(<View />);
    mocks.result = { sessionId: "recording-a", rows: [row("a")] };
    view.rerender(<View />);
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(1));
    const correctionSignal = mocks.chat.mock.calls[0][1].signal;
    const translationSignal = mocks.translate.mock.calls[0][4].signal;
    mocks.settings.transcriptCorrectionEnabled = false;
    view.rerender(<View />);
    expect(correctionSignal.aborted).toBe(true);
    expect(translationSignal.aborted).toBe(false);
    await act(async () => { finishCorrection(edits); finishTranslation("译文"); });
    expect(mocks.saveCorrection).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.saveTranslation).toHaveBeenCalledTimes(1));
  });

  it("unmounting the PDF owner prevents a late correction from being saved", async () => {
    let finish!: (value: string) => void;
    mocks.chat.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const view = render(<View />);
    mocks.result = { sessionId: "recording-a", rows: [row("a")] };
    view.rerender(<View />);
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledTimes(1));
    const signal = mocks.chat.mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(edits); });
    expect(mocks.saveCorrection).not.toHaveBeenCalled();
  });
});
