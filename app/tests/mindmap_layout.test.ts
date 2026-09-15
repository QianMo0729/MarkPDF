import { describe, expect, it } from "vitest";
import { boundsOf, DEFAULT_SIZE, H_GAP, layoutTree, V_GAP } from "../src/domain/mindmap_layout";

describe("mindmap layout", () => {
  const nodes = [
    { id: "r", parentId: null, order: 0, collapsed: false },
    { id: "a", parentId: "r", order: 1, collapsed: false },
    { id: "b", parentId: "r", order: 2, collapsed: false },
    { id: "a1", parentId: "a", order: 1, collapsed: false },
  ];
  it("places children to the right, stacked and centered on the parent", () => {
    const placed = layoutTree(nodes, new Map());
    const r = placed.get("r")!;
    const a = placed.get("a")!;
    const b = placed.get("b")!;
    expect(a.x).toBe(r.w + H_GAP);
    expect(b.x).toBe(a.x);
    expect(b.y - (a.y + a.h)).toBe(V_GAP);
    const mid = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
    expect(r.y + r.h / 2).toBeCloseTo(mid);
    expect(placed.get("a1")!.x).toBe(a.x + DEFAULT_SIZE.w + H_GAP);
  });
  it("hides descendants of collapsed nodes", () => {
    const placed = layoutTree(nodes.map((n) => (n.id === "a" ? { ...n, collapsed: true } : n)), new Map());
    expect(placed.has("a1")).toBe(false);
    expect(boundsOf(placed.values()).maxX).toBe(DEFAULT_SIZE.w + H_GAP + DEFAULT_SIZE.w);
  });
});
