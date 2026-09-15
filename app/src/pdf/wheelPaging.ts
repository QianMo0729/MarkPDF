/**
 * Wheel → page flip for single-page mode (docs/SPEC.md 6.5.4).
 *
 * Modelled on pdf.js PDFPresentationMode (web/pdf_presentation_mode.js) and
 * `normalizeWheelEventDelta` in web/ui_utils.js: deltas are normalised to page units — a
 * pixel-mode delta is divided by 30 px/line × 30 lines/page = 900, a line-mode delta by
 * 30 — and a flip happens once the accumulated delta reaches PAGE_SWITCH_THRESHOLD
 * (0.1 page = 90 px). One mouse notch (100 px in Chromium / WebView2, 3 lines in Firefox)
 * crosses that on its own, so one notch = one page; trackpads emit many small deltas that
 * add up to the same threshold. After a flip, events are ignored for
 * MOUSE_SCROLL_COOLDOWN_MS; a direction change or a pause resets the sum. Unlike pdf.js
 * only deltaY counts, so horizontal trackpad swipes never flip pages.
 */
export const PAGE_SWITCH_THRESHOLD = 0.1;
export const MOUSE_SCROLL_COOLDOWN_MS = 50;
/** A partial delta that stops arriving for this long no longer counts toward the next flip. */
export const ACCUMULATOR_IDLE_MS = 300;

const MOUSE_PIXELS_PER_LINE = 30;
const MOUSE_LINES_PER_PAGE = 30;
// WheelEvent.DOM_DELTA_* — spelled out so this module needs no DOM globals.
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;

export interface WheelDelta {
  deltaY: number;
  deltaMode: number;
}

/** Vertical wheel delta in page units; positive = forward. */
export function normalizeWheelDelta(e: WheelDelta): number {
  if (e.deltaMode === DOM_DELTA_PIXEL) return e.deltaY / (MOUSE_PIXELS_PER_LINE * MOUSE_LINES_PER_PAGE);
  if (e.deltaMode === DOM_DELTA_LINE) return e.deltaY / MOUSE_LINES_PER_PAGE;
  return e.deltaY; // DOM_DELTA_PAGE
}

export interface WheelPager {
  /** Feed a wheel event; returns the flip it caused, if any. */
  handle: (e: WheelDelta) => "next" | "prev" | null;
  reset: () => void;
}

export function createWheelPager(hooks: { next: () => void; prev: () => void; now?: () => number }): WheelPager {
  const now = hooks.now ?? (() => performance.now());
  let acc = 0;
  let lastFlipAt = -Infinity;
  let lastEventAt = -Infinity;
  return {
    reset: () => {
      acc = 0;
    },
    handle: (e) => {
      const t = now();
      if (t - lastEventAt > ACCUMULATOR_IDLE_MS) acc = 0;
      lastEventAt = t;
      const delta = normalizeWheelDelta(e);
      if (delta === 0) return null;
      // Already flipped for this gesture; swallow the tail of the same notch / swipe.
      if (t - lastFlipAt < MOUSE_SCROLL_COOLDOWN_MS) return null;
      if ((acc > 0 && delta < 0) || (acc < 0 && delta > 0)) acc = 0;
      acc += delta;
      if (Math.abs(acc) < PAGE_SWITCH_THRESHOLD) return null;
      const dir = acc > 0 ? "next" : "prev";
      acc = 0;
      lastFlipAt = t;
      if (dir === "next") hooks.next();
      else hooks.prev();
      return dir;
    },
  };
}
