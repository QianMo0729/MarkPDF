import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import katex from "katex";

/**
 * KaTeX live preview for `$…$` (inline) and `$$…$$` (block). The rendered
 * widget shows whenever the cursor is outside the formula; inside it the
 * source stays visible with a subtle mark (docs/SPEC.md 6.5.7 rule 6).
 *
 * "Inside" is the formula's own character range (delimiters included), like
 * Obsidian: typing the closing `$` still shows the source, the next character
 * after it renders the formula. The rest of the line is not affected.
 */

const INLINE_RE = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g;
const BLOCK_RE = /\$\$([\s\S]+?)\$\$/g;

class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.source === this.source && other.display === this.display;
  }
  toDOM() {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "md-math md-math-block" : "md-math md-math-inline";
    try {
      el.innerHTML = katex.renderToString(this.source, { displayMode: this.display, throwOnError: false, output: "html" });
    } catch (e) {
      el.textContent = String(e);
      el.classList.add("md-math-error");
    }
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

export function cursorTouches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    // Boundaries count: a caret right before the opening `$` or right after the
    // closing `$` is still editing the formula.
    if (r.to >= from && r.from <= to) return true;
  }
  return false;
}

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  const taken: [number, number][] = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);

  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    const src = m[1].trim();
    if (!src) continue;
    taken.push([from, to]);
    if (cursorTouches(state, from, to)) {
      ranges.push(Decoration.mark({ class: "md-math-src" }).range(from, to));
      continue;
    }
    const fromLine = state.doc.lineAt(from);
    const toLine = state.doc.lineAt(to);
    const wholeLines = fromLine.from === from && toLine.to === to;
    if (wholeLines) {
      ranges.push(Decoration.replace({ widget: new MathWidget(src, true), block: true }).range(from, to));
    } else {
      ranges.push(Decoration.replace({ widget: new MathWidget(src, true) }).range(from, to));
    }
  }

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    if (overlaps(from, to)) continue;
    const src = m[1].trim();
    if (!src || /^\s/.test(m[1]) || /\s$/.test(m[1])) continue;
    if (cursorTouches(state, from, to)) {
      ranges.push(Decoration.mark({ class: "md-math-src" }).range(from, to));
    } else {
      ranges.push(Decoration.replace({ widget: new MathWidget(src, false) }).range(from, to));
    }
  }

  ranges.sort((a, b) => a.from - b.from || (a.value.startSide ?? 0) - (b.value.startSide ?? 0));
  return Decoration.set(ranges, true);
}

export const mathField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.selection) return build(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function mathPreview(): Extension {
  return [mathField];
}
