import { S } from "../core/strings";

/** Session modes (docs/SPEC.md 1.2). */
export type SessionMode = "reading" | "live" | "replay";

/** Panel ids are fixed by the spec (6.5.6) and used as dockview component names. */
export type PanelId =
  | "notes"
  | "mindmap"
  | "annotations"
  | "outline"
  | "search"
  | "translate"
  | "explain"
  | "transcript"
  | "summary"
  | "ask";

export interface PanelDef {
  id: PanelId;
  title: string;
  icon: string;
  modes: SessionMode[];
  /** Not added to default layouts; only reachable from the "+" menu. */
  optional?: boolean;
}

export const PANELS: PanelDef[] = [
  { id: "notes", title: S.panels.notes, icon: "edit_note", modes: ["reading", "live", "replay"] },
  { id: "mindmap", title: S.panels.mindmap, icon: "account_tree", modes: ["reading", "live", "replay"] },
  { id: "annotations", title: S.panels.annotations, icon: "format_ink_highlighter", modes: ["reading", "live", "replay"] },
  { id: "outline", title: S.panels.outline, icon: "toc", modes: ["reading", "live", "replay"] },
  { id: "search", title: S.panels.search, icon: "search", modes: ["reading", "live", "replay"] },
  { id: "translate", title: S.panels.translate, icon: "translate", modes: ["reading", "live", "replay"] },
  { id: "explain", title: S.panels.explain, icon: "lightbulb", modes: ["reading", "live", "replay"] },
  { id: "transcript", title: S.panels.transcript, icon: "subtitles", modes: ["live", "replay"] },
  { id: "summary", title: S.panels.summary, icon: "auto_awesome", modes: ["live", "replay"] },
  { id: "ask", title: S.panels.ask, icon: "forum", modes: ["reading", "live", "replay"], optional: true },
];

export const PANEL_BY_ID: Record<PanelId, PanelDef> = Object.fromEntries(PANELS.map((p) => [p.id, p])) as Record<
  PanelId,
  PanelDef
>;

export function panelsForMode(mode: SessionMode): PanelDef[] {
  return PANELS.filter((p) => p.modes.includes(mode));
}

export function isPanelId(id: string): id is PanelId {
  return id in PANEL_BY_ID;
}
