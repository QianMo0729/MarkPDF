import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  local: vi.fn(), ai: vi.fn(), navigate: vi.fn(), configured: false,
  settings: { translateTarget: "zh", translationMode: "local", llmBaseUrl: "", llmApiKey: "", llmModel: "" },
  setSetting: vi.fn(),
}));
vi.mock("../src/data/translation/localTranslation", () => ({ translateLocal: mocks.local }));
vi.mock("../src/data/api/llm", () => ({
  chat: mocks.ai,
  isLlmConfigured: () => mocks.configured,
  LlmNotConfiguredError: class extends Error { constructor() { super("AI 服务未配置"); } },
}));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../src/stores/settings", () => ({ useSettings: (select: (state: unknown) => unknown) => select({ settings: mocks.settings, set: mocks.setSetting }) }));
vi.mock("../src/features/session/sessionStore", () => ({
  useSessionUi: (select: (state: unknown) => unknown) => select({ deckId: null }),
  useViewerState: () => ({ currentPage: 1 }),
}));
vi.mock("../src/features/session/controllers/noteEditor", () => ({ useNoteEditor: { getState: () => ({ appendToCurrentNote: vi.fn() }) } }));
vi.mock("../src/data/db/repos/decks", () => ({ getDeckPage: vi.fn() }));
vi.mock("../src/platform/clipboard", () => ({ copyText: vi.fn() }));

import { TranslatePanel } from "../src/features/session/panels/TranslatePanel";
import { useTranslateStore } from "../src/features/session/controllers/translate";

const props = { api: { setActive: vi.fn() } } as unknown as IDockviewPanelProps;

beforeEach(() => {
  mocks.local.mockReset().mockResolvedValue("本地译文");
  mocks.ai.mockReset().mockResolvedValue("AI 译文");
  mocks.configured = false;
  Object.assign(mocks.settings, { translationMode: "local", llmBaseUrl: "", llmApiKey: "", llmModel: "" });
  useTranslateStore.setState({ request: null, history: { translate: [], explain: [] } });
});
afterEach(cleanup);

describe("translation panel", () => {
  it("allows local translation before an AI service is configured", async () => {
    render(<TranslatePanel {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "待翻译文本" }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译", exact: true }));
    await screen.findByText("本地译文");
    expect(mocks.ai).not.toHaveBeenCalled();
  });

  it("uses AI for one request without changing the default local setting", async () => {
    mocks.configured = true;
    render(<TranslatePanel {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "待翻译文本" }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "单次用 AI 翻译" }));
    await screen.findByText("AI 译文");
    expect(mocks.local).not.toHaveBeenCalled();
    expect(mocks.settings.translationMode).toBe("local");
  });

  it("cancels on clear and ignores an answer arriving afterwards", async () => {
    let finish!: (value: string) => void;
    let signal!: AbortSignal;
    mocks.local.mockImplementation((_text, _target, opts) => { signal = opts.signal; return new Promise<string>((resolve) => { finish = resolve; }); });
    render(<TranslatePanel {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "待翻译文本" }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译", exact: true }));
    await waitFor(() => expect(mocks.local).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(signal.aborted).toBe(true);
    await act(async () => { finish("过期译文"); });
    expect(screen.queryByText("过期译文")).not.toBeInTheDocument();
    expect(useTranslateStore.getState().history.translate).toHaveLength(0);
  });

  it("processes an initial selection under React StrictMode", async () => {
    useTranslateStore.setState({ request: { text: "hello", action: "translate", nonce: 1 } });
    render(<StrictMode><TranslatePanel {...props} /></StrictMode>);
    await screen.findByText("本地译文");
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});
