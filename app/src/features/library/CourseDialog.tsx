import { useEffect, useState } from "react";
import { S } from "../../core/strings";
import { Dialog } from "../../core/ui/Dialog";
import { COURSE_COLORS } from "../../data/db/repos/courses";
import type { CourseRow } from "../../data/db/schema";

export interface CourseDialogValue {
  name: string;
  term: string | null;
  colorIndex: number;
}

interface Props {
  open: boolean;
  initial?: CourseRow;
  onSubmit: (value: CourseDialogValue) => void | Promise<void>;
  onClose: () => void;
}

export function CourseDialog({ open, initial, onSubmit, onClose }: Props) {
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [colorIndex, setColorIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setTerm(initial?.term ?? "");
    setColorIndex(initial?.color_index ?? Math.floor(Math.random() * COURSE_COLORS.length));
  }, [open, initial]);

  const valid = name.trim().length > 0;
  const submit = () => valid && onSubmit({ name: name.trim(), term: term.trim() || null, colorIndex });

  return (
    <Dialog
      open={open}
      title={initial ? S.library.rename : S.library.newCourse}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-outlined" onClick={onClose}>
            {S.courseDialog.cancel}
          </button>
          <button className="btn btn-filled" disabled={!valid} onClick={submit}>
            {initial ? S.courseDialog.save : S.courseDialog.create}
          </button>
        </>
      }
    >
      <label className="col" style={{ gap: 4 }}>
        <span className="caption">{S.courseDialog.name}</span>
        <input
          className="input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>
      <label className="col" style={{ gap: 4 }}>
        <span className="caption">{S.courseDialog.term}</span>
        <input
          className="input"
          value={term}
          placeholder={S.courseDialog.termPlaceholder}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>
      <div className="col" style={{ gap: 4 }}>
        <span className="caption">{S.courseDialog.color}</span>
        <div className="row" style={{ gap: 8 }} role="radiogroup" aria-label={S.courseDialog.color}>
          {COURSE_COLORS.map((c, i) => (
            <button
              key={c}
              role="radio"
              aria-checked={i === colorIndex}
              aria-label={`颜色 ${i + 1}`}
              className={`color-swatch ${i === colorIndex ? "selected" : ""}`}
              style={{ background: c }}
              onClick={() => setColorIndex(i)}
            />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
