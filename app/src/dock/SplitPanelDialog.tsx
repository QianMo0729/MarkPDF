import { useEffect, useRef, useState } from "react";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { useContextMenu } from "../core/ui/ContextMenu";
import { toast } from "../core/ui/Toast";
import { useNoteEditor } from "../features/session/controllers/noteEditor";
import { panelsForMode, type SessionMode } from "./panelRegistry";

/** One click: current tab stays here, the previous tab opens in a new group. */
export function SplitPanelButton(props: IDockviewHeaderActionsProps & { mode: SessionMode }) {
  const [busy, setBusy] = useState(false);
  const visits = useRef<string[]>([]);
  const busyRef = useRef(false);
  const menu = useContextMenu();
  const api = props.containerApi;
  useEffect(() => {
    const visit = (id: string | undefined) => {
      if (!id || visits.current[0] === id) return;
      visits.current = [id, ...visits.current.filter((p) => p !== id)].slice(0, 20);
    };
    visit(props.group.activePanel?.id);
    const subscription = props.group.api.onDidActivePanelChange((event) => visit(event.panel?.id));
    return () => subscription.dispose();
  }, [props.group]);

  const split = async (direction: "below" | "right") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await useNoteEditor.getState().flush();
      if (!api.groups.includes(props.group)) return;
      const current = props.group.activePanel;
      const previous = visits.current.map((id) => api.getPanel(id))
        .find((panel) => panel && panel !== current && panel.group.id === props.group.id)
        ?? props.group.panels.find((panel) => panel !== current);
      const unopened = panelsForMode(props.mode).find((def) => !api.getPanel(def.id));
      if (!previous && !unopened) {
        toast("这个视图只有一个标签。先用 + 把另一个标签加入本栏，再分栏。");
        return;
      }
      const height = props.group.api.height;
      const width = props.group.api.width;
      const group = api.addGroup({ referenceGroup: props.group, direction });
      if (previous) previous.api.moveTo({ group, position: "center" });
      else if (unopened) api.addPanel({ id: unopened.id, component: unopened.id, title: unopened.title, position: { referenceGroup: group, direction: "within" } });
      current?.api.setActive();
      group.api.setSize(direction === "below" ? { height: Math.floor(height / 2) } : { width: Math.floor(width / 2) });
    } catch (e) {
      toast(String(e), "error");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return <>
    <button className="icon-btn dock-split" aria-label="分栏" title="分栏（右键选择方向）" disabled={busy}
      onClick={() => void split("below")}
      onContextMenu={(e) => menu.open(e, [
        { label: "向下分栏", onClick: () => void split("below") },
        { label: "向右分栏", onClick: () => void split("right") },
      ])}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
        <rect x="3" y="3" width="18" height="18" rx="1" />
        <path d="M3 12h18" />
      </svg>
    </button>
    {menu.element}
  </>;
}
