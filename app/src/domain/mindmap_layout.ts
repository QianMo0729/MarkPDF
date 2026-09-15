/**
 * Tidy horizontal tree layout for the mind map (docs/SPEC.md 6.5.19): root on
 * the left, children stacked to the right, each subtree vertically centered on
 * its parent. Sizes come from the DOM; unknown nodes use a default box.
 */

export interface LayoutNode {
  id: string;
  parentId: string | null;
  order: number;
  collapsed: boolean;
}

export interface Size {
  w: number;
  h: number;
}

export interface Placed extends Size {
  id: string;
  x: number;
  y: number;
}

export const H_GAP = 56;
export const V_GAP = 14;
export const DEFAULT_SIZE: Size = { w: 200, h: 56 };

export function layoutTree(nodes: LayoutNode[], sizes: Map<string, Size>): Map<string, Placed> {
  const children = new Map<string | null, LayoutNode[]>();
  for (const n of nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = nodes.filter((n) => n.parentId === null || !byId.has(n.parentId));
  const size = (id: string) => sizes.get(id) ?? DEFAULT_SIZE;
  const out = new Map<string, Placed>();

  const subtreeHeight = new Map<string, number>();
  const measure = (n: LayoutNode): number => {
    const own = size(n.id).h;
    const kids = n.collapsed ? [] : (children.get(n.id) ?? []);
    if (!kids.length) {
      subtreeHeight.set(n.id, own);
      return own;
    }
    const total = kids.reduce((acc, k) => acc + measure(k), 0) + V_GAP * (kids.length - 1);
    const h = Math.max(own, total);
    subtreeHeight.set(n.id, h);
    return h;
  };
  const place = (n: LayoutNode, x: number, top: number) => {
    const s = size(n.id);
    const h = subtreeHeight.get(n.id) ?? s.h;
    out.set(n.id, { id: n.id, x, y: top + (h - s.h) / 2, w: s.w, h: s.h });
    const kids = n.collapsed ? [] : (children.get(n.id) ?? []);
    if (!kids.length) return;
    const total = kids.reduce((acc, k) => acc + (subtreeHeight.get(k.id) ?? 0), 0) + V_GAP * (kids.length - 1);
    let cy = top + (h - total) / 2;
    for (const k of kids) {
      place(k, x + s.w + H_GAP, cy);
      cy += (subtreeHeight.get(k.id) ?? 0) + V_GAP;
    }
  };

  let y = 0;
  for (const r of roots) {
    const h = measure(r);
    place(r, 0, y);
    y += h + V_GAP * 3;
  }
  return out;
}

export function boundsOf(placed: Iterable<Placed>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Cubic bezier from the parent's right edge to the child's left edge. */
export function edgePath(parent: Placed, child: Placed): string {
  const x1 = parent.x + parent.w;
  const y1 = parent.y + parent.h / 2;
  const x2 = child.x;
  const y2 = child.y + child.h / 2;
  const dx = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
