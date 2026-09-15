import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegmentRow } from "../src/data/db/schema";

const mocks = vi.hoisted(() => ({
  translate: vi.fn(), save: vi.fn(),
  settings: { transcriptTranslationEnabled: true, translateTarget: "zh", translationMode: "local" },
  result: { sessionId: "recording-a", rows: [] as TranscriptSegmentRow[] },
}));
vi.mock("../src/stores/settings", () => ({ useSettings: (selector: (value: unknown) => unknown) => selector({ settings: mocks.settings }) }));
vi.mock("../src/data/db/client", () => ({ select: vi.fn() }));
vi.mock("../src/data/db/live", () => ({ useLiveQuery: () => ({ data: mocks.result }) }));
vi.mock("../src/data/db/repos/transcripts", () => ({ saveSegmentTranslation: mocks.save }));
vi.mock("../src/features/session/controllers/translate", () => ({ runTextAction: mocks.translate }));

import { TranscriptTranslationProvider, useSharedTranscriptTranslation } from "../src/features/session/controllers/TranscriptTranslationContext";

function row(id: string, index = 0, sessionId = "recording-a"): TranscriptSegmentRow {
  return { id, session_id: sessionId, source: "device", t0_ms: index * 1000, t1_ms: (index + 1) * 1000, text: `Sentence ${id}`, translation: null, lang: "en", page_index: 0, created_at: "", updated_at: "", dirty: 1 };
}
function Probe({ mode }: { mode: string }) {
  const shared = useSharedTranscriptTranslation();
  return <div>{mode}: {shared?.translation.pendingCount}</div>;
}
function View({ mode = "live", sessionId = "recording-a" }: { mode?: string; sessionId?: string }) {
  return <TranscriptTranslationProvider sessionId={sessionId}><Probe key={mode} mode={mode} /></TranscriptTranslationProvider>;
}

beforeEach(() => {
  mocks.translate.mockReset().mockResolvedValue("译文");
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.settings.transcriptTranslationEnabled = true;
  mocks.result = { sessionId: "recording-a", rows: [] };
});
afterEach(cleanup);

describe("recording-owned translation lifecycle", () => {
  it("retains queued sentences when live mode rebuilds the panel as replay", async () => {
    let finish!: (value: string) => void;
    mocks.translate.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const view = render(<View />);
    mocks.result = { sessionId: "recording-a", rows: [row("a"), row("b", 1), row("c", 2)] };
    view.rerender(<View />);
    expect(mocks.translate).toHaveBeenCalledTimes(1);
    const signal = mocks.translate.mock.calls[0][4].signal;
    expect(screen.getByText("live: 2")).toBeInTheDocument();
    view.rerender(<View mode="replay" />);
    expect(signal.aborted).toBe(false);
    expect(screen.getByText("replay: 2")).toBeInTheDocument();
    expect(mocks.translate).toHaveBeenCalledTimes(1);
    await act(async () => { finish("第一句"); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
    expect(mocks.translate.mock.calls.map((args) => args[1])).toEqual(["Sentence a", "Sentence b", "Sentence c"]);
  });

  it("cancels the old recording and ignores its late answer when switching recordings", async () => {
    let finish!: (value: string) => void;
    mocks.translate.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const view = render(<View />);
    mocks.result = { sessionId: "recording-a", rows: [row("a")] };
    view.rerender(<View />);
    const signal = mocks.translate.mock.calls[0][4].signal;
    // The live query still has recording-a's cached rows when the route changes.
    view.rerender(<View sessionId="recording-b" />);
    expect(signal.aborted).toBe(true);
    await act(async () => { finish("late old recording"); });
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.result = { sessionId: "recording-b", rows: [row("b", 0, "recording-b")] };
    view.rerender(<View sessionId="recording-b" />);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].session_id).toBe("recording-b");
  });

  it.each(["disable", "unmount"])("prevents late persistence after %s", async (action) => {
    let finish!: (value: string) => void;
    mocks.translate.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const view = render(<View />);
    mocks.result = { sessionId: "recording-a", rows: [row("a")] };
    view.rerender(<View />);
    const signal = mocks.translate.mock.calls[0][4].signal;
    if (action === "unmount") view.unmount();
    else { mocks.settings.transcriptTranslationEnabled = false; view.rerender(<View />); }
    expect(signal.aborted).toBe(true);
    await act(async () => { finish("late result"); });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
