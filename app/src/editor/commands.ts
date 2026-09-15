import type { EditorView } from "@codemirror/view";

/** Toolbar operations on a CodeMirror view (docs/SPEC.md 6.5.7 toolbar). */

export function wrapSelection(view: EditorView, before: string, after = before, placeholder = ""): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const inner = selected || placeholder;
  const insert = before + inner + after;
  view.dispatch({
    changes: { from, to, insert },
    selection: selected
      ? { anchor: from + before.length, head: from + before.length + inner.length }
      : { anchor: from + before.length, head: from + before.length + inner.length },
  });
  view.focus();
}

/** Toggle a prefix such as "# ", "- " or "- [ ] " on every selected line. */
export function toggleLinePrefix(view: EditorView, prefix: string): void {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);
  const changes: { from: number; to: number; insert: string }[] = [];
  let allHave = true;
  for (let n = startLine.number; n <= endLine.number; n++) {
    if (!view.state.doc.line(n).text.startsWith(prefix)) allHave = false;
  }
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = view.state.doc.line(n);
    if (allHave) changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    else changes.push({ from: line.from, to: line.from, insert: prefix });
  }
  view.dispatch({ changes });
  view.focus();
}

export function cycleHeading(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const m = /^(#{1,6})\s/.exec(line.text);
  const level = m ? m[1].length : 0;
  const next = level >= 3 ? 0 : level + 1;
  const stripped = line.text.replace(/^#{1,6}\s/, "");
  const insert = next === 0 ? stripped : `${"#".repeat(next)} ${stripped}`;
  view.dispatch({ changes: { from: line.from, to: line.to, insert } });
  view.focus();
}

export function insertAtCursor(view: EditorView, text: string, cursorOffset = text.length): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + cursorOffset } });
  view.focus();
}

export function insertCodeBlock(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const line = view.state.doc.lineAt(from);
  const lead = line.from === from ? "" : "\n";
  const text = `${lead}\`\`\`\n${selected}\n\`\`\`\n`;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + lead.length + 4 } });
  view.focus();
}

export function insertMath(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const line = view.state.doc.lineAt(from);
  if (line.text.trim() === "" && !selected) {
    view.dispatch({ changes: { from, to, insert: "$$\n\n$$" }, selection: { anchor: from + 3 } });
  } else {
    wrapSelection(view, "$", "$", "E = mc^2");
    return;
  }
  view.focus();
}

export function insertLink(view: EditorView): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const label = selected || "链接文字";
  const text = `[${label}](https://)`;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + label.length + 3, head: from + text.length - 1 } });
  view.focus();
}

/** Append a block at the end of the document, separated by a blank line. */
export function appendBlock(view: EditorView, block: string): void {
  const doc = view.state.doc;
  const end = doc.length;
  const trailing = doc.toString().replace(/\s+$/, "");
  const sep = trailing.length === 0 ? "" : "\n\n";
  const insert = `${sep}${block.trim()}\n`;
  const from = trailing.length;
  view.dispatch({ changes: { from, to: end, insert }, selection: { anchor: from + insert.length } });
}
