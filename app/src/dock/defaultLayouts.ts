import type { PanelId, SessionMode } from "./panelRegistry";

/**
 * Default dock layouts (docs/SPEC.md 6.5.6). Outer array = groups stacked top to
 * bottom; inner array = tabs in that group, first one active.
 */
export const DEFAULT_LAYOUTS: Record<SessionMode, PanelId[][]> = {
  reading: [["notes", "mindmap", "annotations", "outline", "search", "translate", "explain"]],
  live: [
    ["notes", "mindmap", "annotations"],
    ["transcript", "translate", "explain"],
  ],
  replay: [
    ["notes", "summary", "mindmap", "annotations"],
    ["transcript", "translate", "explain"],
  ],
};

/** sync_state key holding the serialized dockview layout for a mode. */
export function layoutStateKey(mode: SessionMode): string {
  return `dock_layout_${mode}`;
}
