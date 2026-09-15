import { useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../../../core/strings";
import { ConfirmDialog } from "../../../core/ui/Dialog";
import { Icon } from "../../../core/ui/Icon";
import { fmtClockPadded } from "../../../core/utils/time";
import type { MarkerKind } from "../../../domain/timeline";
import { useRecording } from "../controllers/recording";
import { LevelMeter } from "./LevelMeter";
import "./transport.css";

const MARKERS: { kind: MarkerKind; icon: string; label: string; color: string; key: string }[] = [
  { kind: "important", icon: "star", label: S.session.important, color: "var(--mark-important)", key: "F1" },
  { kind: "confused", icon: "help", label: S.session.confused, color: "var(--mark-confused)", key: "F2" },
  { kind: "homework", icon: "assignment", label: S.session.homework, color: "var(--mark-homework)", key: "F3" },
];

interface Props {
  onEnded: () => void;
}

/** Chip label/style per engine state (docs/SPEC.md 6.5.13). */
export function asrChipFor(asr: "off" | "loading" | "on" | "lagging" | "error" | "no_model"): { label: string; cls: string } {
  switch (asr) {
    case "on":
      return { label: "转写中", cls: "asr-on" };
    case "lagging":
      return { label: "转写延迟", cls: "asr-model" };
    case "loading":
      return { label: "加载模型…", cls: "asr-model" };
    case "no_model":
      return { label: "下载模型", cls: "asr-model" };
    case "error":
      return { label: "转写失败", cls: "asr-off" };
    default:
      return { label: "转写关闭", cls: "asr-off" };
  }
}

/** Live transport bar (docs/SPEC.md 6.5.13 / 6.5.14); the record button itself sits in the SlideToolbar. */
export function TransportBarLive({ onEnded }: Props) {
  const rec = useRecording();
  const navigate = useNavigate();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [flash, setFlash] = useState<MarkerKind | null>(null);

  const mark = (kind: MarkerKind) => {
    void rec.addMarker(kind);
    setFlash(kind);
    window.setTimeout(() => setFlash(null), 300);
  };

  const caption = rec.status === "idle" ? S.session.prepare : rec.status === "recording" ? S.session.recording : S.session.paused;
  const asrChip = asrChipFor(rec.asr);

  return (
    <div className="transport">
      <div className="col" style={{ gap: 0 }}>
        <span className="title tabular">{fmtClockPadded(rec.tMs)}</span>
        <span className="caption">{caption}</span>
      </div>
      <LevelMeter db={rec.status === "recording" ? rec.levelDb : -60} />
      {rec.asr === "no_model" ? (
        <button className={`chip asr-chip ${asrChip.cls}`} onClick={() => navigate("/settings/asr")} title="下载转写模型" style={{ cursor: "pointer" }}>
          {asrChip.label}
        </button>
      ) : (
        <span className={`chip asr-chip ${asrChip.cls}`} title={rec.asr === "error" ? S.errors.asrModel : undefined}>
          {rec.asr === "on" && <span className="asr-dot" />}
          {asrChip.label}
        </span>
      )}
      <span className="grow" />
      <div className="marker-bar" role="group" aria-label="标记">
        {MARKERS.map((m) => (
          <button
            key={m.kind}
            className={`marker-btn ${flash === m.kind ? "flash" : ""}`}
            style={{ "--marker": m.color } as React.CSSProperties}
            disabled={rec.status === "idle"}
            title={rec.status === "idle" ? S.session.markerDisabled : `${m.label} (${m.key})`}
            aria-label={m.label}
            onClick={() => mark(m.kind)}
          >
            <Icon name={m.icon} size={20} />
            <span className="caption">{m.label}</span>
          </button>
        ))}
      </div>
      <button className="btn btn-outlined btn-record" disabled={rec.status === "idle"} onClick={() => setConfirmEnd(true)}>
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
          await rec.stop();
          onEnded();
        }}
      />
    </div>
  );
}
