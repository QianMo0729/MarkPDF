import { S } from "../core/strings";
import { Icon } from "../core/ui/Icon";

export interface SelectionAction {
  id: "copy" | "highlight" | "note" | "translate" | "addToNotes" | "explain" | "excerpt";
  label: string;
  icon: string;
}

export const SELECTION_ACTIONS: SelectionAction[] = [
  { id: "copy", label: S.tools.copy, icon: "content_copy" },
  { id: "highlight", label: S.tools.highlight, icon: "ink_highlighter" },
  { id: "note", label: S.tools.note, icon: "chat_bubble" },
  { id: "translate", label: S.tools.translate, icon: "translate" },
  { id: "addToNotes", label: S.tools.addToNotes, icon: "playlist_add" },
  { id: "explain", label: S.tools.explain, icon: "lightbulb" },
  { id: "excerpt", label: S.tools.excerpt, icon: "account_tree" },
];

interface Props {
  /** Position in the viewer's coordinate space (top-left of the toolbar). */
  x: number;
  y: number;
  enabled: SelectionAction["id"][];
  onAction: (id: SelectionAction["id"]) => void;
}

/** Floating toolbar over a text selection (docs/SPEC.md 6.5.4). */
export function SelectionToolbar({ x, y, enabled, onAction }: Props) {
  return (
    <div
      className="selection-toolbar"
      style={{ left: x, top: y }}
      role="toolbar"
      onMouseDown={(e) => {
        // Keep the text selection and stop the host from dismissing the toolbar before the click lands.
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {SELECTION_ACTIONS.map((a) => (
        <button
          key={a.id}
          className="selection-toolbar-btn"
          disabled={!enabled.includes(a.id)}
          title={a.label}
          aria-label={a.label}
          onClick={() => onAction(a.id)}
        >
          <Icon name={a.icon} size={18} />
          <span className="caption" style={{ color: "inherit" }}>
            {a.label}
          </span>
        </button>
      ))}
    </div>
  );
}
