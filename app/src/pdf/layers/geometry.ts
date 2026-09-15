export type Point = [number, number];
export type Stroke = Point[];

/** Douglas–Peucker polyline simplification (docs/SPEC.md 6.5.5: ε = 0.5 pt). */
export function simplify(points: Stroke, epsilon = 0.5): Stroke {
  if (points.length <= 2) return points.slice();
  let maxDist = 0;
  let index = 0;
  const [a, b] = [points[0], points[points.length - 1]];
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return Math.hypot(p[0] - x, p[1] - y);
}

/** True when `p` is within `tolerance` of any segment of the stroke. */
export function strokeHit(stroke: Stroke, p: Point, tolerance: number): boolean {
  if (stroke.length === 1) return Math.hypot(stroke[0][0] - p[0], stroke[0][1] - p[1]) <= tolerance;
  for (let i = 1; i < stroke.length; i++) if (distToSegment(p, stroke[i - 1], stroke[i]) <= tolerance) return true;
  return false;
}

export function pointInRect(p: Point, x: number, y: number, w: number, h: number): boolean {
  return p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h;
}

export function quadHit(quads: number[][], p: Point): boolean {
  return quads.some((q) => {
    const xs = [q[0], q[2], q[4], q[6]];
    const ys = [q[1], q[3], q[5], q[7]];
    return pointInRect(p, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  });
}

export function strokeToPath(points: Point[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]} l 0.01 0`;
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
}
