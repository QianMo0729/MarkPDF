/** True in the macOS build's WKWebView (and in a Mac browser during `npm run dev`). */
export const isMac = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

const MAC_MODIFIERS: Record<string, string> = { Alt: "⌥", Shift: "⇧", Ctrl: "⌘" };
const MAC_ORDER = ["⌥", "⇧", "⌘"];

/**
 * A shortcut as the user should read it. Handlers accept Ctrl or ⌘ everywhere, so
 * "Ctrl+Shift+R" stays as is on Windows and becomes "⇧⌘R" on macOS.
 */
export function shortcutLabel(combo: string): string {
  if (!isMac) return combo;
  const keys = combo.split("+");
  const key = keys.pop() ?? "";
  const modifiers = keys.map((k) => MAC_MODIFIERS[k] ?? k).sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
  return modifiers.join("") + key;
}
