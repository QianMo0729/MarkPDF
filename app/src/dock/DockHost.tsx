import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FunctionComponent } from "react";
import { resolvedTheme } from "../core/theme/theme";
import { S } from "../core/strings";
import { useContextMenu } from "../core/ui/ContextMenu";
import { Icon } from "../core/ui/Icon";
import { getState, setState } from "../data/db/repos/syncState";
import { useSessionUi } from "../features/session/sessionStore";
import { useSetting } from "../stores/settings";
import { DEFAULT_LAYOUTS, layoutStateKey } from "./defaultLayouts";
import { PANEL_BY_ID, isPanelId, panelsForMode, type PanelId, type SessionMode } from "./panelRegistry";
import { SplitPanelButton } from "./SplitPanelDialog";

export type PanelComponent = FunctionComponent<IDockviewPanelProps>;

/** Bring a panel to front, adding it to the first group if it is closed. */
export function activatePanel(api: DockviewApi, id: PanelId): void {
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const def = PANEL_BY_ID[id];
  const first = api.groups[0];
  api.addPanel({
    id,
    component: id,
    title: def.title,
    position: first ? { referenceGroup: first, direction: "within" } : undefined,
  });
}

interface DockHostProps {
  mode: SessionMode;
  /** Panel implementations keyed by PanelId; missing ids get a placeholder. */
  components: Partial<Record<PanelId, PanelComponent>>;
}

function PlaceholderPanel(props: IDockviewPanelProps) {
  const id = props.api.id;
  const def = isPanelId(id) ? PANEL_BY_ID[id] : undefined;
  return (
    <div className="empty" style={{ height: "100%" }}>
      <Icon name={def?.icon ?? "widgets"} size={40} className="text3" />
      <div className="subtitle">{def?.title ?? id}</div>
      <div className="body-small text2">{S.panels.comingSoon}</div>
    </div>
  );
}

function buildDefaultLayout(api: DockviewApi, mode: SessionMode) {
  let previousGroupAnchor: string | undefined;
  for (const group of DEFAULT_LAYOUTS[mode]) {
    let anchor: string | undefined;
    group.forEach((id, i) => {
      const def = PANEL_BY_ID[id];
      api.addPanel({
        id,
        component: id,
        title: def.title,
        position:
          i === 0
            ? previousGroupAnchor
              ? { referencePanel: previousGroupAnchor, direction: "below" }
              : undefined
            : { referencePanel: anchor as string, direction: "within" },
      });
      if (i === 0) anchor = id;
    });
    previousGroupAnchor = anchor;
  }
  for (const group of DEFAULT_LAYOUTS[mode]) api.getPanel(group[0])?.api.setActive();
}

/** Right-side dock area: registry-driven panels, persisted layout, "+" menu (docs/SPEC.md 6.5.6). */
export function DockHost({ mode, components }: DockHostProps) {
  const themePref = useSetting("theme");
  const [scheme, setScheme] = useState(() => resolvedTheme(themePref));
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingLayout = useRef<{ key: string; value: string } | null>(null);
  const layoutSubscription = useRef<{ dispose: () => void } | null>(null);
  const layoutReady = useRef(false);
  const loadGeneration = useRef(0);
  const saveKey = useRef(layoutStateKey(mode));

  const flushLayout = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = pendingLayout.current;
    pendingLayout.current = null;
    if (pending) void setState(pending.key, pending.value).catch(() => undefined);
  }, []);

  useLayoutEffect(() => () => {
    loadGeneration.current += 1;
    layoutSubscription.current?.dispose();
    layoutSubscription.current = null;
    // Dockview disposes in its passive-effect cleanup. Capture the final grid
    // before that, including a change whose buffered layout event has not fired.
    if (layoutReady.current && apiRef.current) {
      try {
        pendingLayout.current = { key: saveKey.current, value: JSON.stringify(apiRef.current.toJSON()) };
      } catch { /* A previously captured snapshot remains safe to save. */ }
    }
    flushLayout();
    layoutReady.current = false;
    if (useSessionUi.getState().dockApi === apiRef.current) useSessionUi.getState().setDockApi(null);
    apiRef.current = null;
  }, [flushLayout]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setScheme(resolvedTheme(themePref));
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [themePref]);

  const allComponents = useMemo(() => {
    const map: Record<string, PanelComponent> = {};
    for (const def of panelsForMode(mode)) map[def.id] = components[def.id] ?? PlaceholderPanel;
    map.ask = components.ask ?? PlaceholderPanel;
    return map;
  }, [mode, components]);

  const scheduleSave = useCallback(() => {
    const api = apiRef.current;
    if (!api || !layoutReady.current) return;
    pendingLayout.current = { key: saveKey.current, value: JSON.stringify(api.toJSON()) };
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushLayout, 500);
  }, [flushLayout]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      const generation = ++loadGeneration.current;
      layoutSubscription.current?.dispose();
      layoutSubscription.current = null;
      layoutReady.current = false;
      apiRef.current = api;
      saveKey.current = layoutStateKey(mode);
      useSessionUi.getState().setDockApi(api);
      (async () => {
        const knownKey = `${layoutStateKey(mode)}_known`;
        const [saved, knownValue] = await Promise.all([
          getState(layoutStateKey(mode)).catch(() => null),
          getState(knownKey).catch(() => null),
        ]);
        const known = new Set((knownValue ?? "").split(",").filter(Boolean));
        if (apiRef.current !== api || generation !== loadGeneration.current) return;
        let restored = false;
        if (saved) {
          try {
            api.fromJSON(JSON.parse(saved));
            restored = api.panels.length > 0;
          } catch {
            restored = false;
          }
        }
        if (!restored) {
          api.clear();
          buildDefaultLayout(api, mode);
        } else {
          // Panels added to the app after this layout was saved show up once, in the first group.
          for (const id of DEFAULT_LAYOUTS[mode].flat()) {
            if (!known.has(id) && known.size > 0 && !api.getPanel(id)) activatePanel(api, id);
          }
        }
        layoutReady.current = true;
        layoutSubscription.current = api.onDidLayoutChange(scheduleSave);
        scheduleSave();
        // This compatibility marker must not gate saving or discard a restored
        // layout when its independent metadata write fails.
        void setState(knownKey, DEFAULT_LAYOUTS[mode].flat().join(",")).catch(() => undefined);
      })().catch(() => undefined);
    },
    [mode, scheduleSave],
  );

  const HeaderActions = useMemo(
    () =>
      function DockHeaderActions(props: IDockviewHeaderActionsProps) {
        return <><SplitPanelButton {...props} mode={mode} /><AddPanelButton {...props} mode={mode} /></>;
      },
    [mode],
  );

  return (
    <DockviewReact
      className="markpdf-dock"
      components={allComponents}
      rightHeaderActionsComponent={HeaderActions}
      onReady={onReady}
      theme={scheme === "dark" ? themeDark : themeLight}
      disableFloatingGroups
    />
  );
}

function AddPanelButton(props: IDockviewHeaderActionsProps & { mode: SessionMode }) {
  const menu = useContextMenu();
  const api = props.containerApi;

  const openMenu = (e: React.MouseEvent) => {
    const closed = panelsForMode(props.mode).filter((p) => api.getPanel(p.id)?.group.id !== props.group.id);
    menu.open(e, [
      ...closed.map((p) => ({
        label: p.title,
        icon: p.icon,
        onClick: () => {
          const existing = api.getPanel(p.id);
          if (existing) existing.api.moveTo({ group: props.group, position: "center" });
          else api.addPanel({ id: p.id, component: p.id, title: p.title, position: { referenceGroup: props.group, direction: "within" } });
        },
      })),
      {
        label: S.session.resetLayout,
        icon: "restart_alt",
        onClick: () => {
          api.clear();
          buildDefaultLayout(api, props.mode);
        },
      },
    ]);
  };

  return (
    <>
      <button className="icon-btn dock-add" aria-label={S.session.addPanel} title={S.session.addPanel} onClick={openMenu}>
        <Icon name="add" size={20} />
      </button>
      {menu.element}
    </>
  );
}
