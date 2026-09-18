import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  onLogin: vi.fn(),
  settings: { codexPath: "", codexModel: "", codexEffort: "" },
  setSetting: vi.fn(),
}));
vi.mock("../src/platform/codex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/platform/codex")>()),
  codexStatus: mocks.status,
  onCodexLogin: mocks.onLogin,
}));
vi.mock("../src/data/api/llm", () => ({ testConnection: vi.fn() }));
vi.mock("../src/stores/settings", () => ({
  useSettings: (select: (state: unknown) => unknown) => select({ settings: mocks.settings, set: mocks.setSetting }),
}));

import { CodexSettings } from "../src/features/settings/CodexSettings";

beforeEach(() => {
  mocks.status.mockReset();
  mocks.onLogin.mockReset().mockResolvedValue(vi.fn());
});
afterEach(cleanup);

describe("Codex CLI detection feedback", () => {
  it.each(["codex_not_found", "codex_not_found: no installation found"])("offers installation guidance for %s", async (message) => {
    mocks.status.mockRejectedValue(message);
    render(<CodexSettings />);

    expect(await screen.findByText("没有找到 codex 可执行文件")).toBeInTheDocument();
    expect(screen.getByText("npm install -g @openai/codex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录 ChatGPT" })).toBeDisabled();
  });

  it.each([
    "cannot run C:\\Tools\\codex.exe: Access is denied (os error 5)",
    "C:\\Tools\\codex.exe did not report a version",
    "cannot run C:\\codex_not_found\\codex.exe: invalid executable",
    "codex app-server exited before initialization",
  ])("preserves the actionable error: %s", async (message) => {
    mocks.status.mockRejectedValue(new Error(message));
    render(<CodexSettings />);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText("没有找到 codex 可执行文件")).not.toBeInTheDocument();
    expect(screen.queryByText("npm install -g @openai/codex")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录 ChatGPT" })).toBeDisabled();
  });

  it("clears the previous error and enables login after a successful retry", async () => {
    const message = "cannot run C:\\Tools\\codex.exe: Access is denied (os error 5)";
    mocks.status.mockRejectedValueOnce(message).mockResolvedValueOnce({
      info: { path: "C:\\Tools\\codex.exe", version: "codex-cli 0.114.0" },
      account: null,
      requires_openai_auth: true,
    });
    render(<CodexSettings />);
    await screen.findByText(message);

    fireEvent.click(screen.getByRole("button", { name: "重新检测" }));

    expect(await screen.findByText("已找到 codex-cli 0.114.0")).toBeInTheDocument();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录 ChatGPT" })).toBeEnabled();
  });
});
