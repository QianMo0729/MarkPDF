import { describe, expect, it } from "vitest";
import { activeOutlinePath, type OutlineNode } from "../src/pdf/outline";
import { layoutClassFor } from "../src/core/layout/breakpoints";

const node = (title: string, pageIndex: number, items: OutlineNode[] = []): OutlineNode => ({ title, dest: null, pageIndex, items });

describe("activeOutlinePath", () => {
  const tree = [node("1. Intro", 0, [node("1.1", 1)]), node("2. Hashing", 3, [node("2.1", 4), node("2.2", 6)]), node("3. Unresolved", -1)];

  it("returns the deepest node at or before the page", () => {
    expect(activeOutlinePath(tree, 0)?.title).toBe("1. Intro");
    expect(activeOutlinePath(tree, 2)?.title).toBe("1.1");
    expect(activeOutlinePath(tree, 5)?.title).toBe("2.1");
    expect(activeOutlinePath(tree, 9)?.title).toBe("2.2");
  });
  it("ignores unresolved destinations", () => {
    expect(activeOutlinePath([node("x", -1)], 5)).toBeNull();
  });
});

describe("layoutClassFor", () => {
  it("splits at 600 and 1024", () => {
    expect(layoutClassFor(599)).toBe("compact");
    expect(layoutClassFor(600)).toBe("medium");
    expect(layoutClassFor(1023)).toBe("medium");
    expect(layoutClassFor(1024)).toBe("expanded");
  });
});
