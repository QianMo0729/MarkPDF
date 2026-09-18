import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { cursorTouches, mathField } from "../src/editor/extensions/math";

function state(doc: string, cursor: number) {
  return EditorState.create({ doc, selection: { anchor: cursor }, extensions: [mathField] });
}
function widgets(s: EditorState): number {
  let n = 0;
  s.field(mathField).between(0, s.doc.length, () => { n++; });
  return n;
}

describe("inline math live preview", () => {
  const doc = "a $x^2$ b";
  it("keeps the source while the caret sits on or inside the formula", () => {
    expect(cursorTouches(state(doc, 2), 2, 7)).toBe(true); // before the opening $
    expect(cursorTouches(state(doc, 4), 2, 7)).toBe(true); // inside
    expect(cursorTouches(state(doc, 7), 2, 7)).toBe(true); // right after the closing $
  });
  it("renders as soon as a character follows the closing $, without a newline", () => {
    expect(cursorTouches(state(doc, 8), 2, 7)).toBe(false);
    const rendered = state(doc, 8);
    let replaced = false;
    rendered.field(mathField).between(0, doc.length, (_f, _t, d) => { if (d.spec.widget) replaced = true; });
    expect(replaced).toBe(true);
    let marked = false;
    state(doc, 7).field(mathField).between(0, doc.length, (_f, _t, d) => { if (d.spec.class === "md-math-src") marked = true; });
    expect(marked).toBe(true);
  });
  it("does not hide a formula because the caret is elsewhere on the same line", () => {
    expect(widgets(state("$a$ and $b$", 1))).toBe(2);
    let replacedB = false;
    state("$a$ and $b$", 1).field(mathField).between(8, 11, (_f, _t, d) => { if (d.spec.widget) replacedB = true; });
    expect(replacedB).toBe(true);
  });
});
