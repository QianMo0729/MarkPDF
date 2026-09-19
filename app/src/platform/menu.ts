import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isMac } from "./os";

/**
 * The macOS menu bar (src-tauri/src/menu.rs). A menu item's key equivalent is
 * consumed by the menu before the webview sees it, so every command arrives
 * here as an event instead of a keydown.
 */

/** Ids of the custom items; standard ones (copy, minimize, quit…) never reach the webview. */
export type MenuCommand =
  | "settings"
  | "open"
  | "export-pdf"
  | "export-markdown"
  | "print"
  | "undo"
  | "redo"
  | "find"
  | "toggle-rail"
  | "toggle-dock"
  | "zoom-in"
  | "zoom-out"
  | "zoom-fit"
  | "editor-mode"
  | "record"
  | "mark-important"
  | "mark-confused"
  | "mark-homework";

export function onMenuCommand(cb: (command: MenuCommand) => void): Promise<UnlistenFn> {
  if (!isMac) return Promise.resolve(() => undefined);
  return listen<MenuCommand>("menu://command", (e) => cb(e.payload));
}

export interface MenuContext {
  /** A deck or a recording is open (the session screen). */
  session: boolean;
  /** The open session can record. */
  live: boolean;
  recording: boolean;
  railOpen: boolean;
  dockOpen: boolean;
}

/** Tell the menu bar what is on screen so it can dim items and keep Show / Hide titles current. */
export function syncMenu(context: MenuContext): void {
  if (isMac) void invoke("menu_sync", { context }).catch(() => undefined);
}

/** Commands that already have a keyboard shortcut, as the chord their handler listens for. */
const SHORTCUTS: Partial<Record<MenuCommand, KeyboardEventInit>> = {
  "export-pdf": { key: "e", shiftKey: true },
  undo: { key: "z" },
  redo: { key: "z", shiftKey: true },
  find: { key: "f" },
  "toggle-rail": { key: "\\", shiftKey: true },
  "toggle-dock": { key: "\\" },
  "zoom-in": { key: "=" },
  "zoom-out": { key: "-" },
  "zoom-fit": { key: "0" },
  "editor-mode": { key: "e" },
  record: { key: "r", shiftKey: true },
  "mark-important": { key: "F1", metaKey: false },
  "mark-confused": { key: "F2", metaKey: false },
  "mark-homework": { key: "F3", metaKey: false },
};

/**
 * Run a menu command through the keydown handlers that own the shortcut (the
 * session screen, the note editor), so menu and keyboard cannot drift apart.
 * Returns false for commands without a shortcut; the caller handles those.
 */
export function replayShortcut(command: MenuCommand): boolean {
  const chord = SHORTCUTS[command];
  if (!chord) return false;
  const target = document.activeElement ?? document.body;
  const unhandled = target.dispatchEvent(new KeyboardEvent("keydown", { metaKey: true, bubbles: true, cancelable: true, ...chord }));
  // Plain text fields have no key handler of their own: their undo stack is the browser's.
  if (unhandled && (command === "undo" || command === "redo")) document.execCommand(command);
  return true;
}
