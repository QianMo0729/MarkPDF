import { S } from "../../core/strings";
import { Dialog } from "../../core/ui/Dialog";
import { Icon } from "../../core/ui/Icon";
import type { DeckRow } from "../../data/db/schema";
import { DeckThumbnail } from "../../pdf/DeckThumbnail";

interface Props {
  open: boolean;
  decks: DeckRow[];
  onChoose: (deck: DeckRow) => void;
  onImport: () => void;
  onClose: () => void;
}

/** "开始上课" → pick the deck to record against (docs/SPEC.md 6.4.3). */
export function DeckChooserDialog({ open, decks, onChoose, onImport, onClose }: Props) {
  const ready = decks.filter((d) => d.status === "ready");
  return (
    <Dialog open={open} title={S.course.chooseDeck} onClose={onClose} width={440}>
      <div className="col" style={{ gap: 4, maxHeight: 360, overflowY: "auto" }}>
        {ready.map((d) => (
          <button key={d.id} className="deck-choice" onClick={() => onChoose(d)}>
            <DeckThumbnail deckId={d.id} pageIndex={0} width={64} height={36} />
            <span className="col grow" style={{ textAlign: "left", minWidth: 0 }}>
              <span className="body" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.title}
              </span>
              <span className="caption">{S.course.pages(d.page_count)}</span>
            </span>
          </button>
        ))}
        <button className="deck-choice" onClick={onImport}>
          <span className="row" style={{ width: 64, justifyContent: "center" }}>
            <Icon name="upload_file" size={22} className="text2" />
          </span>
          <span className="body text2">{S.course.importNew}</span>
        </button>
      </div>
    </Dialog>
  );
}
