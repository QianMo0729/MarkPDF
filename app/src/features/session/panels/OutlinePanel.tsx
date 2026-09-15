import { useMemo } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { S } from "../../../core/strings";
import { Icon } from "../../../core/ui/Icon";
import { usePdfDocument } from "../../../pdf/documents";
import { activeOutlinePath, useOutline } from "../../../pdf/outline";
import { OutlineTree } from "../../../pdf/OutlineTree";
import { useSessionUi, useViewerState } from "../sessionStore";

/** Bookmark tree panel (docs/SPEC.md 6.5.9). Shares data with the rail's outline tab. */
export function OutlinePanel(_props: IDockviewPanelProps) {
  const deckId = useSessionUi((s) => s.deckId);
  const controller = useSessionUi((s) => s.controller);
  const { doc } = usePdfDocument(deckId);
  const { outline, loaded } = useOutline(doc);
  const state = useViewerState();
  const active = useMemo(() => activeOutlinePath(outline, state.currentPage), [outline, state.currentPage]);

  if (loaded && outline.length === 0) {
    return (
      <div className="empty" style={{ height: "100%" }}>
        <Icon name="toc" size={40} />
        <div className="body-small">{S.session.noOutline}</div>
      </div>
    );
  }
  return (
    <div className="scroll-y" style={{ height: "100%" }}>
      <OutlineTree nodes={outline} active={active} rowHeight={32} onSelect={(n) => controller?.goToDestination(n.dest)} />
    </div>
  );
}
