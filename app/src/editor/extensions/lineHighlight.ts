import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";

/** Highlight whole lines (1-based numbers) — replay "当时的笔记" shows lines added since the previous snapshot. */
export function lineHighlight(lines: number[], className = "md-line-added"): Extension {
  const wanted = new Set(lines);
  const deco = Decoration.line({ class: className });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
        if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
      }
      build(view: EditorView) {
        const b = new RangeSetBuilder<Decoration>();
        for (let n = 1; n <= view.state.doc.lines; n++) {
          if (!wanted.has(n)) continue;
          const line = view.state.doc.line(n);
          b.add(line.from, line.from, deco);
        }
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
