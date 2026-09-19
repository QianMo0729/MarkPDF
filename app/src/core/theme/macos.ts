import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMac } from "../../platform/os";

/**
 * The parts of the macOS look that CSS alone cannot express (see macos.css):
 * the platform stamp, the accent color from System Settings, and full screen.
 */
export function installMacAppearance(): void {
  if (!isMac) return;
  const root = document.documentElement;
  root.dataset.platform = "macos";

  // `AccentColor` is the color chosen in System Settings > Appearance. Resolve it to
  // plain rgb() so color-mix() and the canvas widgets that read --accent can use it;
  // a WebKit without the keyword keeps the system blue of macos.css.
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none";
  probe.style.color = "AccentColor";
  root.appendChild(probe);
  const syncAccent = () => {
    if (probe.style.color) root.style.setProperty("--accent", getComputedStyle(probe).color);
  };
  syncAccent();
  // The accent changes with the appearance (light / dark variant) and whenever people
  // pick another one, which they do in another app: re-read on return.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncAccent);
  window.addEventListener("focus", syncAccent);

  // Full screen hides the window buttons, so the toolbar takes their room back.
  const syncFullscreen = () =>
    void getCurrentWindow()
      .isFullscreen()
      .then((on) => root.toggleAttribute("data-fullscreen", on))
      .catch(() => undefined);
  syncFullscreen();
  window.addEventListener("resize", syncFullscreen);
}
