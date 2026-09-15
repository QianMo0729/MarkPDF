import { useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../../../core/strings";
import { ConfirmDialog } from "../../../core/ui/Dialog";
import { Icon } from "../../../core/ui/Icon";
import { fmtClockPadded } from "../../../core/utils/time";
import { useRecording } from "../controllers/recording";
import "./transport.css";

/**
 * Shown on every screen outside the session while a class is being recorded
 * (settings, model download, library…): the recording stays visible and can be
 * ended from anywhere (release audit PM-01 / F4).
 */
export function RecordingBanner() {
  const rec = useRecording();
  const navigate = useNavigate();
  const [confirmEnd, setConfirmEnd] = useState(false);
  if (rec.status === "idle" || !rec.sessionId) return null;
  return (
    <div className="recording-banner" role="status">
      <span className={`live-dot ${rec.status === "paused" ? "paused" : ""}`} />
      <span className="body-small">
        {rec.status === "recording" ? S.session.recording : S.session.paused} · {fmtClockPadded(rec.tMs)}
      </span>
      <span className="grow" />
      <button className="btn btn-text toolbar-small" onClick={() => navigate(`/session/${rec.sessionId}`)}>
        <Icon name="arrow_back" size={16} /> {S.session.backToClass}
      </button>
      <button className="btn btn-outlined btn-record toolbar-small" onClick={() => setConfirmEnd(true)}>
        {S.session.endClass}
      </button>
      <ConfirmDialog
        open={confirmEnd}
        title={S.session.endTitle}
        body={S.session.endBody}
        confirmLabel={S.session.end}
        cancelLabel={S.session.continueRecording}
        danger
        onCancel={() => setConfirmEnd(false)}
        onConfirm={async () => {
          setConfirmEnd(false);
          await useRecording.getState().stop();
        }}
      />
    </div>
  );
}
