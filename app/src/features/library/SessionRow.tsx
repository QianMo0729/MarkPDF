import { S } from "../../core/strings";
import { fmtDateTime, fmtDuration } from "../../core/utils/time";
import type { SessionListItem } from "../../data/db/repos/sessions";
import { DeckThumbnail } from "../../pdf/DeckThumbnail";

interface Props {
  session: SessionListItem;
  onClick: () => void;
}

/** 72 px list row used by the "recent" tab and the course page (docs/SPEC.md 6.4.2). */
export function SessionRow({ session, onClick }: Props) {
  const when = session.started_at ?? session.created_at;
  return (
    <button className="session-row" onClick={onClick}>
      <DeckThumbnail deckId={session.deck_id} pageIndex={0} width={64} height={36} />
      <span className="col grow" style={{ gap: 2, textAlign: "left" }}>
        <span className="subtitle" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {session.title}
        </span>
        <span className="caption">
          {fmtDateTime(when)}
          {session.duration_ms != null && <>{"  "}{fmtDuration(session.duration_ms)}</>}
        </span>
      </span>
      <span className="row" style={{ gap: 6 }}>
        {session.asr_status === "server_done" && <span className="chip">{S.library.chipTranscribed}</span>}
        {session.summary_status === "ready" && <span className="chip">{S.library.chipSummarized}</span>}
      </span>
    </button>
  );
}
