import { describe, expect, it } from "vitest";
import { ACCUMULATOR_IDLE_MS, MOUSE_SCROLL_COOLDOWN_MS, createWheelPager } from "../src/pdf/wheelPaging";

function pager() {
  let t = 0;
  const flips: string[] = [];
  const p = createWheelPager({ next: () => flips.push("next"), prev: () => flips.push("prev"), now: () => t });
  return {
    flips,
    wheel: (deltaY: number, deltaMode = 0) => p.handle({ deltaY, deltaMode }),
    tick: (ms: number) => (t += ms),
  };
}

describe("wheel paging", () => {
  it("flips exactly one page per mouse notch (Chromium: 100 px)", () => {
    const p = pager();
    expect(p.wheel(100)).toBe("next");
    p.tick(120);
    expect(p.wheel(100)).toBe("next");
    p.tick(120);
    expect(p.wheel(-100)).toBe("prev");
    expect(p.flips).toEqual(["next", "next", "prev"]);
  });

  it("flips one page per line-mode notch (Firefox: 3 lines)", () => {
    const p = pager();
    expect(p.wheel(3, 1)).toBe("next");
    p.tick(120);
    expect(p.wheel(-3, 1)).toBe("prev");
  });

  it("adds small trackpad deltas up to a single flip", () => {
    const p = pager();
    for (let i = 0; i < 10; i++) {
      p.wheel(12);
      p.tick(16);
    }
    expect(p.flips).toEqual(["next"]);
  });

  it("resets the sum when the direction changes", () => {
    const p = pager();
    p.wheel(60);
    p.wheel(-60);
    expect(p.wheel(-20)).toBeNull();
    expect(p.wheel(-20)).toBe("prev");
  });

  it("ignores the tail of a gesture during the cooldown", () => {
    const p = pager();
    expect(p.wheel(100)).toBe("next");
    p.tick(10);
    expect(p.wheel(100)).toBeNull();
    p.tick(MOUSE_SCROLL_COOLDOWN_MS);
    expect(p.wheel(100)).toBe("next");
  });

  it("forgets a stale partial delta", () => {
    const p = pager();
    p.wheel(60);
    p.tick(ACCUMULATOR_IDLE_MS + 1);
    expect(p.wheel(60)).toBeNull();
    expect(p.wheel(60)).toBe("next");
  });
});
