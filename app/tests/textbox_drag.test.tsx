import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationRow } from "../src/data/db/schema";
vi.mock("@atomic-editor/editor", () => ({}));
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
vi.mock("../src/editor/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
import { TextBoxAnnotation } from "../src/pdf/layers/TextBoxAnnotation";

const geom = { widthPt: 960, heightPt: 540, scale: 1.5, rotation: 0 };
const row = { id: "a1", kind: "text_box", page_index: 0, x: 300, y: 100, w: 260, h: 40, markdown: "hello", color: "#000", font_size: 20, fill_color: null, border_color: null } as unknown as AnnotationRow;

function pointer(type: string, x: number, y: number, target?: Element) {
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }) as unknown as PointerEvent;
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  (target ?? window).dispatchEvent(ev);
}

describe("text box drag", () => {
  it("moves left and commits a smaller x", async () => {
    const onCommit = vi.fn();
    const r = render(<TextBoxAnnotation row={row} geom={geom} selected editing={false} flash={false} readOnly={false} interactive editOnClick={false}
      onSelect={() => {}} onEdit={() => {}} onEndEdit={() => {}} onCommit={onCommit} />);
    const body = r.container.querySelector(".mp-tb-body")!;
    await act(async () => { pointer("pointerdown", 500, 200, body); });
    await act(async () => { pointer("pointermove", 400, 200); });
    const box = r.container.querySelector<HTMLElement>(".mp-tb")!;
    expect(box.style.left).toBe(`${300 * 1.5 - 100}px`);
    await act(async () => { pointer("pointerup", 400, 200); });
    expect(onCommit).toHaveBeenCalledWith({ x: 233.33, y: 100 });
  });
  it("resizes from the west handle", async () => {
    const onCommit = vi.fn();
    const r = render(<TextBoxAnnotation row={row} geom={geom} selected editing={false} flash={false} readOnly={false} interactive editOnClick={false}
      onSelect={() => {}} onEdit={() => {}} onEndEdit={() => {}} onCommit={onCommit} />);
    const handle = r.container.querySelector(".mp-handle.w")!;
    await act(async () => { pointer("pointerdown", 450, 200, handle); });
    await act(async () => { pointer("pointermove", 300, 200); });
    await act(async () => { pointer("pointerup", 300, 200); });
    expect(onCommit).toHaveBeenCalledWith({ x: 200, y: 100, w: 360, h: 40 });
  });
});
