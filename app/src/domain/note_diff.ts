import { diffLines } from "diff";

/** Line-level diff used by replay "当时的笔记" and the AI context builder (docs/SPEC.md 6.5.7 / 11.1). */

export interface DiffLine {
  text: string;
  added: boolean;
}

/** Lines of `current` with `added` set for lines not present in `previous`. */
export function diffAddedLines(previous: string, current: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const part of diffLines(previous, current)) {
    if (part.removed) continue;
    const lines = part.value.replace(/\n$/, "").split("\n");
    if (part.value === "") continue;
    for (const line of lines) out.push({ text: line, added: !!part.added });
  }
  return out;
}

/** Only the newly added lines (for the AI context: "我当时记的"). */
export function addedLines(previous: string, current: string): string[] {
  return diffAddedLines(previous, current)
    .filter((l) => l.added && l.text.trim() !== "")
    .map((l) => l.text);
}
