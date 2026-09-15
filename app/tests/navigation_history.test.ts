import { describe, expect, it } from "vitest";
import { PdfNavigationHistory, type PdfPosition } from "../src/pdf/navigationHistory";

const position = (page: number, top = 700): PdfPosition => ({ page, top, left: 0, scaleValue: "page-width", rotation: 0, viewMode: "single" });

describe("PDF navigation history", () => {
  it("returns to the origin of a link and forward to the actual place read after jumping", () => {
    const history = new PdfNavigationHistory();
    const origin = { ...position(3, 450), left: 17, scaleValue: "1.5", rotation: 90, viewMode: "continuous" as const };
    history.remember(origin);
    expect(history.back(position(12, 310))).toEqual(origin);
    expect(history.canGoBack).toBe(false);
    expect(history.canGoForward).toBe(true);
    expect(history.forward(origin)).toEqual(position(12, 310));
  });

  it("handles multiple jumps including different destinations on the same page", () => {
    const history = new PdfNavigationHistory();
    history.remember(position(1));
    history.remember(position(8, 500));
    expect(history.back(position(8, 100))).toEqual(position(8, 500));
    expect(history.back(position(8, 500))).toEqual(position(1));
    expect(history.forward(position(1))).toEqual(position(8, 500));
    expect(history.forward(position(8, 500))).toEqual(position(8, 100));
  });

  it("discards the forward branch after following a new link", () => {
    const history = new PdfNavigationHistory();
    history.remember(position(1));
    history.back(position(8));
    history.remember(position(1, 400));
    expect(history.canGoForward).toBe(false);
    expect(history.back(position(20))).toEqual(position(1, 400));
  });

  it("skips repeated destinations instead of trapping Back, and clears between PDFs", () => {
    const history = new PdfNavigationHistory();
    history.remember(position(1));
    history.remember(position(8));
    history.remember(position(8));
    expect(history.back(position(8))).toEqual(position(1));
    history.clear();
    expect(history.canGoBack).toBe(false);
    expect(history.canGoForward).toBe(false);
    expect(history.back(position(10))).toBeUndefined();
  });
});
