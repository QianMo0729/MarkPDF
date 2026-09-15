import { useEffect, type ReactNode } from "react";
import { S } from "../strings";

interface DialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  /** When true, backdrop clicks and Esc do not close (progress dialogs). */
  locked?: boolean;
  width?: number;
}

export function Dialog({ open, title, children, actions, onClose, locked, width }: DialogProps) {
  useEffect(() => {
    if (!open || locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, locked, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={() => !locked && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="subtitle">{title}</div>
        {children}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = S.common.confirm,
  cancelLabel = S.common.cancel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button className="btn btn-outlined" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`btn btn-filled ${danger ? "btn-record" : ""}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      {body && <div className="body text2">{body}</div>}
    </Dialog>
  );
}
