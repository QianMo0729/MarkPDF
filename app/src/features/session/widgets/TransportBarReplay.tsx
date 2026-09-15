import { S } from "../../../core/strings";
import { useContextMenu } from "../../../core/ui/ContextMenu";
import { Icon } from "../../../core/ui/Icon";
import { fmtClockPadded } from "../../../core/utils/time";
import type { MarkerKind, Timeline } from "../../../domain/timeline";
import { useSettings } from "../../../stores/settings";
import { usePlayback } from "../controllers/playback";
import "./transport.css";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const MARKERS: { kind: MarkerKind; label: string; color: string }[] = [
  { kind: "important", label: S.session.important, color: "var(--mark-important)" },
  { kind: "confused", label: S.session.confused, color: "var(--mark-confused)" },
  { kind: "homework", label: S.session.homework, color: "var(--mark-homework)" },
];

interface Props {
  timeline: Timeline | null;
  onJumpTo: (ms: number) => void;
}

/** Replay transport bar (docs/SPEC.md 6.5.15). */
export function TransportBarReplay({ timeline, onJumpTo }: Props) {
  const pb = usePlayback();
  const setSetting = useSettings((s) => s.set);
  const speedMenu = useContextMenu();
  const counts = (kind: MarkerKind) => (timeline?.markers ?? []).filter((m) => m.kind === kind).length;

  return (
    <div className="transport">
      <button className="play-btn" onClick={pb.toggle} disabled={!pb.ready && !pb.playing} aria-label={pb.playing ? "暂停" : "播放"} title="Space">
        <Icon name={pb.playing ? "pause" : "play_arrow"} size={28} />
      </button>
      {pb.error && (
        <span className="chip asr-chip asr-off" title={pb.error} style={{ gap: 4 }}>
          {S.session.playbackFailed}
          <button className="btn btn-text toolbar-small" style={{ height: 20, padding: "0 4px" }} onClick={() => void pb.retry()}>
            {S.course.retry}
          </button>
        </span>
      )}
      <div className="transport-time">
        <span className="title tabular">{fmtClockPadded(pb.positionMs)}</span>
        <span className="body-small text2 tabular"> / {fmtClockPadded(pb.durationMs)}</span>
      </div>
      <button className="icon-btn" style={{ width: 40, height: 40 }} aria-label="后退 10 秒" title="J" onClick={() => pb.skip(-10_000)}>
        <Icon name="replay_10" size={24} />
      </button>
      <button className="icon-btn" style={{ width: 40, height: 40 }} aria-label="前进 10 秒" title="L" onClick={() => pb.skip(10_000)}>
        <Icon name="forward_10" size={24} />
      </button>
      <button
        className="btn btn-text toolbar-small tabular"
        onClick={(e) =>
          speedMenu.open(
            e,
            SPEEDS.map((s) => ({
              label: `${s.toFixed(s === 1 ? 1 : 2).replace(/0$/, "")}×`,
              onClick: () => {
                pb.setSpeed(s);
                void setSetting("playbackSpeed", s);
              },
            })),
          )
        }
      >
        {pb.speed.toFixed(pb.speed === 1 ? 1 : 2).replace(/0$/, "")}×
      </button>
      <span className="grow" />
      <button className={`chip ${pb.followPages ? "selected" : ""}`} aria-pressed={pb.followPages} onClick={() => pb.setFollowPages(!pb.followPages)} style={{ height: 28, cursor: "pointer" }}>
        <Icon name="auto_stories" size={16} />
        {S.session.followPages}
      </button>
      <div className="marker-nav">
        {MARKERS.map((m) => {
          const n = counts(m.kind);
          return (
            <button
              key={m.kind}
              className="chip"
              disabled={n === 0}
              style={{ color: n ? m.color : undefined, borderColor: n ? m.color : undefined }}
              title={`跳到下一个${m.label}`}
              onClick={() => {
                const next = timeline?.nextMarker(pb.positionMs, m.kind);
                if (next) onJumpTo(next.tMs);
              }}
            >
              {m.label} {n}
            </button>
          );
        })}
      </div>
      {speedMenu.element}
    </div>
  );
}
