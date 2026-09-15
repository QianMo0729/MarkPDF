/**
 * Page space <-> CSS pixels inside a pdf.js `.page` element (docs/SPEC.md 4.1).
 *
 * Page space: points, origin top-left, y down, at the page's default view
 * (pdf.js `getViewport({ scale: 1 })`). `rotation` is the user's view
 * rotation (0 / 90 / 180 / 270, clockwise) applied on top of that.
 */

export interface PageGeom {
  widthPt: number;
  heightPt: number;
  /** CSS pixels per point: pdf.js zoom × CSS_PX_PER_PT (never the raw zoom value). */
  scale: number;
  rotation: number;
}

/**
 * pdf.js lays a page out at `currentScale × 96/72` CSS px per PDF point
 * (`PixelsPerInch.PDF_TO_CSS_UNITS`), so a 960 pt slide at zoom 1.0 is 1280 px wide.
 * Multiply the viewer's zoom by this before using it as a page-space scale.
 */
export const CSS_PX_PER_PT = 96 / 72;

export function normalizeRotation(r: number): number {
  return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
}

export function cssSize(g: PageGeom): { w: number; h: number } {
  const r = normalizeRotation(g.rotation);
  const swap = r === 90 || r === 270;
  return { w: (swap ? g.heightPt : g.widthPt) * g.scale, h: (swap ? g.widthPt : g.heightPt) * g.scale };
}

export function toCss(g: PageGeom, x: number, y: number): [number, number] {
  const s = g.scale;
  switch (normalizeRotation(g.rotation)) {
    case 90:
      return [(g.heightPt - y) * s, x * s];
    case 180:
      return [(g.widthPt - x) * s, (g.heightPt - y) * s];
    case 270:
      return [y * s, (g.widthPt - x) * s];
    default:
      return [x * s, y * s];
  }
}

export function toPage(g: PageGeom, cx: number, cy: number): [number, number] {
  const s = g.scale;
  switch (normalizeRotation(g.rotation)) {
    case 90:
      return [cy / s, g.heightPt - cx / s];
    case 180:
      return [g.widthPt - cx / s, g.heightPt - cy / s];
    case 270:
      return [g.widthPt - cy / s, cx / s];
    default:
      return [cx / s, cy / s];
  }
}

export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Axis-aligned CSS box of a page-space rectangle after rotation. */
export function rectToCss(g: PageGeom, x: number, y: number, w: number, h: number): CssRect {
  const pts = [toCss(g, x, y), toCss(g, x + w, y), toCss(g, x + w, y + h), toCss(g, x, y + h)];
  return boxOf(pts);
}

/** Quad = [x1,y1,x2,y2,x3,y3,x4,y4] in page space. */
export function quadToCss(g: PageGeom, q: number[]): CssRect {
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i += 2) pts.push(toCss(g, q[i], q[i + 1]));
  return boxOf(pts);
}

function boxOf(pts: [number, number][]): CssRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/** Page-space bounding box of a set of page-space points. */
export function bboxOfPoints(points: [number, number][], pad = 0): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

export function bboxOfQuads(quads: number[][]): { x: number; y: number; w: number; h: number } {
  const pts: [number, number][] = [];
  for (const q of quads) for (let i = 0; i < 8; i += 2) pts.push([q[i], q[i + 1]]);
  return bboxOfPoints(pts);
}

/**
 * Convert a DOM selection range inside a page's text layer into page-space
 * quads, one per visual line. Adjacent rects on the same line are merged.
 */
export function selectionQuads(range: Range, pageDiv: HTMLElement, g: PageGeom): number[][] {
  const pageRect = pageDiv.getBoundingClientRect();
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
  // Merge rects whose vertical extent overlaps a lot (same line).
  const lines: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const r of rects) {
    const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    const line = lines.find((l) => Math.min(l.bottom, box.bottom) - Math.max(l.top, box.top) > 0.5 * Math.min(l.bottom - l.top, box.bottom - box.top));
    if (line) {
      line.left = Math.min(line.left, box.left);
      line.right = Math.max(line.right, box.right);
      line.top = Math.min(line.top, box.top);
      line.bottom = Math.max(line.bottom, box.bottom);
    } else lines.push(box);
  }
  return lines.map((l) => {
    const c = (cx: number, cy: number) => toPage(g, cx - pageRect.left, cy - pageRect.top);
    const [x1, y1] = c(l.left, l.top);
    const [x2, y2] = c(l.right, l.top);
    const [x3, y3] = c(l.left, l.bottom);
    const [x4, y4] = c(l.right, l.bottom);
    // Normalize to page-space TL, TR, BL, BR regardless of rotation.
    const xs = [x1, x2, x3, x4];
    const ys = [y1, y2, y3, y4];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return [minX, minY, maxX, minY, minX, maxY, maxX, maxY];
  });
}
