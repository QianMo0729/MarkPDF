import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  local: vi.fn(), codex: vi.fn(), fetch: vi.fn(), navigate: vi.fn(),
}));
vi.mock("../src/data/translation/localTranslation", () => ({ translateLocal: mocks.local }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.fetch }));
vi.mock("../src/platform/codex", () => ({ codexChat: mocks.codex }));
vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../src/data/db/repos/syncState", () => ({ getState: vi.fn(), setState: vi.fn() }));
vi.mock("../src/features/session/sessionStore", () => ({
  useSessionUi: (select: (state: unknown) => unknown) => select({ deckId: null }),
  useViewerState: () => ({ currentPage: 1 }),
}));
vi.mock("../src/features/session/controllers/noteEditor", () => ({ useNoteEditor: { getState: () => ({ appendToCurrentNote: vi.fn() }) } }));
vi.mock("../src/data/db/repos/decks", () => ({ getDeckPage: vi.fn() }));
vi.mock("../src/platform/clipboard", () => ({ copyText: vi.fn() }));

import { ExplainPanel, TranslatePanel } from "../src/features/session/panels/TranslatePanel";
import { useTranslateStore } from "../src/features/session/controllers/translate";
import { DEFAULT_SETTINGS, useSettings } from "../src/stores/settings";

const props = { api: { setActive: vi.fn() } } as unknown as IDockviewPanelProps;

beforeEach(() => {
  mocks.local.mockReset().mockResolvedValue("本地译文");
  mocks.codex.mockReset().mockResolvedValue({ text: "AI 译文", model: "test-model" });
  mocks.fetch.mockReset();
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
  useTranslateStore.setState({ request: null, history: { translate: [], explain: [] } });
});
afterEach(cleanup);

describe("translation panel", () => {
  it("allows local translation before an AI service is configured", async () => {
    render(<TranslatePanel {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "待翻译文本" }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译", exact: true }));
    await screen.findByText("本地译文");
    expect(mocks.codex).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("uses AI for one request without changing the default local setting", async () => {
    await useSettings.getState().set("llmProvider", "codex");
    render(<TranslatePanel {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "待翻译文本" }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "单次用 AI 翻译" }));
    await screen.findByText("AI 译文");
    expect(mocks.local).not.toHaveBeenCalled();
    expect(useSettings.getState().settings.translationMode).toBe("local");
    expect(mocks.fetch).not.toHaveBeenCalled();
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
    expect(mocks.codex).not.toHaveBeenCalled();
  });

  it.each([
    { Panel: TranslatePanel, action: "翻译", input: "待翻译文本" },
    { Panel: ExplainPanel, action: "解释", input: "待解释文本" },
  ])("uses Codex for $action without requiring custom API credentials", async ({ Panel, action, input }) => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, llmProvider: "codex", translationMode: "ai" } });
    render(<Panel {...props} />);

    expect(screen.queryByText(`${action}需要先配置 AI 服务`)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: input }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: action, exact: true }));

    await screen.findByText("AI 译文");
    expect(mocks.codex).toHaveBeenCalledWith(expect.objectContaining({ user: "hello" }));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("updates the notice when switching providers or editing custom API credentials", async () => {
    await useSettings.getState().set("translationMode", "ai");
    render(<TranslatePanel {...props} />);
    const notice = "翻译需要先配置 AI 服务";
    expect(screen.getByText(notice)).toBeInTheDocument();

    await act(async () => { await useSettings.getState().set("llmProvider", "codex"); });
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    await act(async () => { await useSettings.getState().set("llmProvider", "custom"); });
    expect(screen.getByText(notice)).toBeInTheDocument();
    await act(async () => {
      await useSettings.getState().set("llmBaseUrl", "https://example.test/v1");
      await useSettings.getState().set("llmApiKey", "test-key");
      await useSettings.getState().set("llmModel", "test-model");
    });
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    await act(async () => { await useSettings.getState().set("llmApiKey", "   "); });
    expect(screen.getByText(notice)).toBeInTheDocument();
  });

  it("shows a Codex login error from the request instead of a custom API configuration notice", async () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, llmProvider: "codex", translationMode: "ai" } });
    mocks.codex.mockRejectedValue(new Error("codex_not_logged_in"));
    render(<TranslatePanel {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "待翻译文本" }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "翻译", exact: true }));

    await screen.findByText(/codex_not_logged_in/);
    expect(screen.queryByText("翻译需要先配置 AI 服务")).not.toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
