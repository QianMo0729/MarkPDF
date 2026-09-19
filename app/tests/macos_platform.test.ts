import { afterEach, describe, expect, it, vi } from "vitest";

/** `isMac` is read once at import, so each case loads the modules under its own user agent. */
async function load(userAgent: string) {
  vi.resetModules();
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  return { os: await import("../src/platform/os"), menu: await import("../src/platform/menu") };
}

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/140.0";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("shortcutLabel", () => {
  it("keeps the Windows spelling off macOS", async () => {
    const { os } = await load(WINDOWS);
    expect(os.shortcutLabel("Ctrl+Shift+R")).toBe("Ctrl+Shift+R");
  });

  it("uses Apple's glyphs and modifier order on macOS", async () => {
    const { os } = await load(MAC);
    expect(os.shortcutLabel("Ctrl+Shift+R")).toBe("⇧⌘R");
    expect(os.shortcutLabel("Ctrl+\\")).toBe("⌘\\");
    expect(os.shortcutLabel("Ctrl+Alt+Shift+K")).toBe("⌥⇧⌘K");
  });
});

describe("replayShortcut", () => {
  it("sends the chord of a menu command to the focused element", async () => {
    const { menu } = await load(MAC);
    const input = document.body.appendChild(document.createElement("input"));
    input.focus();
    const seen: KeyboardEvent[] = [];
    window.addEventListener("keydown", (e) => seen.push(e), { once: true });

    expect(menu.replayShortcut("export-pdf")).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].target).toBe(input);
    expect(seen[0]).toMatchObject({ key: "e", metaKey: true, shiftKey: true });
  });

  it("sends the marker keys without ⌘", async () => {
    const { menu } = await load(MAC);
    const seen: KeyboardEvent[] = [];
    window.addEventListener("keydown", (e) => seen.push(e), { once: true });
    menu.replayShortcut("mark-confused");
    expect(seen[0]).toMatchObject({ key: "F2", metaKey: false });
  });

  it("falls back to the browser's undo stack only when no handler took the chord", async () => {
    const { menu } = await load(MAC);
    const execCommand = vi.fn();
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

    menu.replayShortcut("undo");
    expect(execCommand).toHaveBeenCalledWith("undo");

    execCommand.mockClear();
    const handler = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", handler);
    menu.replayShortcut("redo");
    window.removeEventListener("keydown", handler);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("leaves commands without a shortcut to their own listeners", async () => {
    const { menu } = await load(MAC);
    expect(menu.replayShortcut("print")).toBe(false);
    expect(menu.replayShortcut("settings")).toBe(false);
  });
});
