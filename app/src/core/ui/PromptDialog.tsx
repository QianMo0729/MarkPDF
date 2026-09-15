import { useEffect, useState } from "react";
import { S } from "../strings";
import { Dialog } from "./Dialog";

interface Props {
  open: boolean;
  title: string;
  label?: string;
  initial?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}

/** Single text field dialog (rename course / deck / session). */
export function PromptDialog({ open, title, label, initial = "", submitLabel = S.courseDialog.save, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const valid = value.trim().length > 0;
  const submit = () => valid && onSubmit(value.trim());
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-outlined" onClick={onClose}>
            {S.common.cancel}
          </button>
          <button className="btn btn-filled" disabled={!valid} onClick={submit}>
            {submitLabel}
          </button>
        </>
      }
    >
      <label className="col" style={{ gap: 4 }}>
        {label && <span className="caption">{label}</span>}
        <input
          className="input"
          value={value}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            e.stopPropagation();
          }}
        />
      </label>
    </Dialog>
  );
}
