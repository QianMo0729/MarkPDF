import { isMac } from "../../platform/os";

export type ThemePref = "system" | "light" | "dark";

/** Stamp the theme choice on <html>. "system" removes the attribute so the
 *  prefers-color-scheme media query in tokens.css takes over. macOS always
 *  follows the system appearance (HIG, Dark Mode: no app-specific setting). */
export function applyTheme(pref: ThemePref): void {
  const el = document.documentElement;
  if (pref === "system" || isMac) el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", pref);
}

/** Effective theme right now, resolving "system" against the OS. */
export function resolvedTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system" && !isMac) return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
