import { useEffect, useRef } from "react";
import { S } from "../../core/strings";
import { Icon } from "../../core/ui/Icon";
import type { AnnotationRow } from "../../data/db/schema";
import { MarkdownEditor } from "../../editor/MarkdownEditor";
import type { CssRect } from "../coords";

interface Props {
  row: AnnotationRow;
  anchor: CssRect;
  colors: string[];
  readOnly: boolean;
  onColor: (c: string) => void;
  onComment: (markdown: string) => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Popover for a clicked highlight: colors, note, copy, delete (docs/SPEC.md 6.5.5 highlight). */
export function HighlightPopover({ row, anchor, colors, readOnly, onColor, onComment, onCopy, onDelete, onClose }: Props) {
  const draft = useRef(row.markdown ?? "");
  const timer = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const commit = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if ((row.markdown ?? "") !== draft.current) onComment(draft.current);
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        commit();
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        commit();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} className="mp-popover" style={{ left: anchor.left, top: anchor.top + anchor.height + 6 }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="row" style={{ gap: 6 }}>
        {colors.map((c) => (
          <button key={c} className={`tool-swatch ${c.toLowerCase() === row.color.toLowerCase() ? "selected" : ""}`} style={{ background: c }} aria-label={c} disabled={readOnly} onClick={() => onColor(c)} />
        ))}
        <span className="grow" />
        <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label={S.tools.copy} title={S.tools.copy} onClick={onCopy}>
          <Icon name="content_copy" size={16} />
        </button>
        {!readOnly && (
          <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label={S.common.delete} title={S.common.delete} onClick={onDelete}>
            <Icon name="delete" size={16} />
          </button>
        )}
      </div>
      {row.selected_text && (
        <div className="caption" style={{ maxHeight: 40, overflow: "hidden", userSelect: "text" }}>
          {row.selected_text}
        </div>
      )}
      <MarkdownEditor
        documentId={`hl:${row.id}`}
        value={row.markdown ?? ""}
        mode={readOnly ? "reading" : "live"}
        compact
        placeholder="写点备注…"
        onChange={(md) => {
          draft.current = md;
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(commit, 800);
        }}
        onBlur={commit}
        autoFocus={!readOnly}
      />
    </div>
  );
}
