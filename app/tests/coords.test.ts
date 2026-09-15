import { describe, expect, it } from "vitest";
import { cssSize, quadToCss, rectToCss, toCss, toPage, type PageGeom } from "../src/pdf/coords";
import { simplify, strokeHit } from "../src/pdf/layers/geometry";

const g = (rotation: number, scale = 2): PageGeom => ({ widthPt: 960, heightPt: 540, scale, rotation });

describe("coords", () => {
  it("round-trips a point at every rotation", () => {
    for (const r of [0, 90, 180, 270]) {
      const geom = g(r);
      const [cx, cy] = toCss(geom, 100, 40);
      const [x, y] = toPage(geom, cx, cy);
      expect(x).toBeCloseTo(100);
      expect(y).toBeCloseTo(40);
    }
  });
  it("rotates 90° clockwise: top-left corner moves to top-right", () => {
    const geom = g(90, 1);
    expect(toCss(geom, 0, 0)).toEqual([540, 0]);
    expect(cssSize(geom)).toEqual({ w: 540, h: 960 });
  });
  it("scales rectangles and quads", () => {
    expect(rectToCss(g(0), 10, 20, 30, 40)).toEqual({ left: 20, top: 40, width: 60, height: 80 });
    const q = quadToCss(g(180, 1), [0, 0, 10, 0, 0, 5, 10, 5]);
    expect(q).toEqual({ left: 950, top: 535, width: 10, height: 5 });
  });
});

describe("geometry", () => {
  it("simplifies collinear points", () => {
    const pts: [number, number][] = [
      [0, 0],
      [1, 0.1],
      [2, -0.1],
      [3, 0],
      [4, 5],
    ];
    const out = simplify(pts, 0.5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([4, 5]);
    expect(out.length).toBeLessThan(pts.length);
  });
  it("hit-tests strokes with tolerance", () => {
    const stroke: [number, number][] = [
      [0, 0],
      [10, 0],
    ];
    expect(strokeHit(stroke, [5, 1], 2)).toBe(true);
    expect(strokeHit(stroke, [5, 5], 2)).toBe(false);
  });
});
