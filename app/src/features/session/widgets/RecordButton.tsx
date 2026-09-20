import { S } from "../../../core/strings";
import { Icon } from "../../../core/ui/Icon";
import { shortcutLabel } from "../../../platform/os";
import { useRecording } from "../controllers/recording";
import "./transport.css";

interface Props {
  currentPage: number;
  /** Reading / replay: choose a recording before opening the microphone. */
  onStart?: () => void;
  /** 32 px variant for the SlideToolbar; default is the 48 px size. */
  compact?: boolean;
  disabled?: boolean;
}

/** Start / pause / resume recording (docs/SPEC.md 6.5.3, 6.5.13). */
export function RecordButton({ currentPage, compact = false, onStart, disabled = false }: Props) {
  const rec = useRecording();
  const status = onStart ? "idle" : rec.status;
  const onRecord = () => {
    if (onStart) { onStart(); return; }
    if (rec.status === "idle") {
      void rec.start(currentPage);
      return;
    }
    else if (rec.status === "recording") void rec.pause();
    else void rec.resume();
  };
  const label = status === "idle" ? (onStart ? S.session.startClassRecord : S.session.startRecording) : status === "recording" ? S.session.pauseRecording : S.session.continueRecording;
  return (
    <button
      className={`record-btn ${status}${compact ? " compact" : ""}`}
      onClick={onRecord}
      disabled={disabled || rec.starting}
      aria-label={label}
      title={status === "idle" && !onStart ? `${label} (${shortcutLabel("Ctrl+Shift+R")})` : label}
    >
      <Icon name={status === "recording" ? "pause" : "mic"} size={compact ? 20 : 24} />
    </button>
  );
}
