import { S } from "../../../core/strings";
import { Icon } from "../../../core/ui/Icon";
import { useRecording } from "../controllers/recording";
import "./transport.css";

interface Props {
  currentPage: number;
  /** Reading a deck: pressing the idle button starts a class instead of the recorder directly. */
  onStart?: () => void;
  /** 32 px variant for the SlideToolbar; default is the 48 px size. */
  compact?: boolean;
}

/** Start / pause / resume recording (docs/SPEC.md 6.5.3, 6.5.13). */
export function RecordButton({ currentPage, compact = false, onStart }: Props) {
  const rec = useRecording();
  const onRecord = () => {
    if (rec.status === "idle") {
      if (onStart) onStart();
      else void rec.start(currentPage);
      return;
    }
    else if (rec.status === "recording") void rec.pause();
    else void rec.resume();
  };
  const label = rec.status === "idle" ? (onStart ? S.session.startClassRecord : S.session.startRecording) : rec.status === "recording" ? S.session.pauseRecording : S.session.continueRecording;
  return (
    <button
      className={`record-btn ${rec.status}${compact ? " compact" : ""}`}
      onClick={onRecord}
      disabled={rec.starting}
      aria-label={label}
      title={rec.status === "idle" ? `${label} (Ctrl+Shift+R)` : label}
    >
      <Icon name={rec.status === "recording" ? "pause" : "mic"} size={compact ? 20 : 24} />
    </button>
  );
}
