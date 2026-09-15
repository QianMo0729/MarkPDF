import { Facet, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { parseClock } from "../../core/utils/time";

/** `[mm:ss]` / `[h:mm:ss]` tokens render as chips; clicking seeks in replay (docs/SPEC.md 6.5.7). */

export const TIMESTAMP_RE = /\[(\d{1,2}:)?\d{1,2}:\d{2}\]/g;

/** null = chips are not clickable (reading / live). */
export const timestampClickFacet = Facet.define<((ms: number) => void) | null, ((ms: number) => void) | null>({
  combine: (values) => values.find((v) => v !== null) ?? null,
});

class ChipWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly ms: number,
    readonly clickable: boolean,
  ) {
    super();
  }
  eq(other: ChipWidget) {
    return other.label === this.label && other.clickable === this.clickable;
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = `md-chip md-chip-time${this.clickable ? " clickable" : ""}`;
    span.textContent = this.label;
    span.setAttribute("role", this.clickable ? "button" : "text");
    if (this.clickable) {
      span.title = "跳转到该时刻";
      span.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        view.state.facet(timestampClickFacet)?.(this.ms);
      });
    }
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

function build(view: EditorView): DecorationSet {
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  const clickable = view.state.facet(timestampClickFacet) !== null;
  const cursorLines = new Set<number>();
  for (const r of view.state.selection.ranges) {
    cursorLines.add(view.state.doc.lineAt(r.head).number);
    cursorLines.add(view.state.doc.lineAt(r.anchor).number);
  }
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const onCursorLine = cursorLines.has(line.number);
      TIMESTAMP_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TIMESTAMP_RE.exec(line.text))) {
        const s = line.from + m.index;
        const e = s + m[0].length;
        const inner = m[0].slice(1, -1);
        const ms = parseClock(inner);
        if (ms === null) continue;
        if (onCursorLine) {
          marks.push({ from: s, to: e, deco: Decoration.mark({ class: "md-chip-src" }) });
        } else {
          marks.push({ from: s, to: e, deco: Decoration.replace({ widget: new ChipWidget(inner, ms, clickable) }) });
        }
      }
      pos = line.to + 1;
    }
  }
  marks.sort((a, b) => a.from - b.from);
  return Decoration.set(marks.map((m) => m.deco.range(m.from, m.to)));
}

export function timestampChips(onClick: ((ms: number) => void) | null): Extension {
  return [
    timestampClickFacet.of(onClick),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    ),
  ];
}
