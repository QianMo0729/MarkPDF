import { describe, expect, it } from "vitest";
import { addedLines, diffAddedLines } from "../src/domain/note_diff";

describe("note_diff", () => {
  it("flags added lines", () => {
    const prev = "# 标题\n- a\n";
    const cur = "# 标题\n- a\n- b\n";
    expect(diffAddedLines(prev, cur)).toEqual([
      { text: "# 标题", added: false },
      { text: "- a", added: false },
      { text: "- b", added: true },
    ]);
    expect(addedLines(prev, cur)).toEqual(["- b"]);
  });
  it("treats everything as added when there is no previous snapshot", () => {
    expect(addedLines("", "x\ny")).toEqual(["x", "y"]);
  });
});
