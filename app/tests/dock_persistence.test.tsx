import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  saved: '{"layout":"saved-split"}',
  failKnownRead: false,
  failKnownWrite: false,
  deferReads: false,
  reads: [] as (() => void)[],
  writes: [] as { key: string; value: string }[],
  model: { layout: "initial" },
  disposed: false,
  readsAfterDispose: 0,
  listeners: new Set<() => void>(),
  api: null as any,
  dockApi: null as any,
}));

vi.mock("../src/data/db/repos/syncState", () => ({
  getState: (key: string) => {
    const value = key.endsWith("_known") ? "notes,mindmap,annotations,outline,search,translate,explain" : fixture.saved;
    if (fixture.deferReads) return new Promise(resolve => fixture.reads.push(() => resolve(value)));
    if (key.endsWith("_known") && fixture.failKnownRead) return Promise.reject(new Error("Metadata read failed"));
    return Promise.resolve(value);
  },
  setState: async (key: string, value: string) => {
    if (key.endsWith("_known") && fixture.failKnownWrite) throw new Error("Metadata write failed");
    fixture.writes.push({ key, value });
  },
}));
vi.mock("../src/features/session/sessionStore", () => ({
  useSessionUi: { getState: () => ({ dockApi: fixture.dockApi, setDockApi: (api: unknown) => { fixture.dockApi = api; } }) },
}));
vi.mock("../src/stores/settings", () => ({ useSetting: () => "light" }));
vi.mock("../src/core/theme/theme", () => ({ resolvedTheme: () => "light" }));
vi.mock("../src/dock/SplitPanelDialog", () => ({ SplitPanelButton: () => null }));
vi.mock("dockview-react", async () => {
  const React = await import("react");
  return {
    themeDark: {}, themeLight: {},
    DockviewReact: ({ onReady }: { onReady: (event: { api: unknown }) => void }) => {
      React.useEffect(() => {
        onReady({ api: fixture.api });
        // Mirror the actual DockviewReact lifecycle: dispose in a passive effect.
        return () => { fixture.disposed = true; };
      }, []);
      return <div>Dock fixture</div>;
    },
  };
});

import { DockHost } from "../src/dock/DockHost";

const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const layoutWrites = () => fixture.writes.filter(w => !w.key.endsWith("_known"));

describe("dock layout persistence lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, removeEventListener() {} }));
    fixture.saved = '{"layout":"saved-split"}';
    fixture.failKnownRead = false;
    fixture.failKnownWrite = false;
    fixture.deferReads = false;
    fixture.reads = [];
    fixture.writes = [];
    fixture.model = { layout: "initial" };
    fixture.disposed = false;
    fixture.readsAfterDispose = 0;
    fixture.listeners.clear();
    fixture.dockApi = null;
    fixture.api = {
      panels: [] as { id: string }[], groups: [],
      fromJSON: vi.fn((value: { layout: string }) => { fixture.model = value; fixture.api.panels = [{ id: "notes" }]; }),
      toJSON: vi.fn(() => {
        if (fixture.disposed) { fixture.readsAfterDispose += 1; throw new Error("Disposed API"); }
        return fixture.model;
      }),
      clear: vi.fn(() => { fixture.api.panels = []; }),
      addPanel: vi.fn(({ id }: { id: string }) => { fixture.api.panels.push({ id }); }),
      getPanel: (id: string) => fixture.api.panels.find((panel: { id: string }) => panel.id === id) ? { api: { setActive() {} } } : undefined,
      onDidLayoutChange: (listener: () => void) => {
        fixture.listeners.add(listener);
        return { dispose: () => fixture.listeners.delete(listener) };
      },
    };
  });

  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("preserves a restored layout and installs saving even when compatibility metadata cannot be written", async () => {
    fixture.failKnownWrite = true;
    render(<DockHost mode="reading" components={{}} />);
    await settle();
    expect(fixture.api.clear).not.toHaveBeenCalled();
    expect(fixture.model.layout).toBe("saved-split");
    expect(fixture.listeners.size).toBe(1);
    fixture.model = { layout: "new-split" };
    act(() => { for (const listener of fixture.listeners) listener(); vi.advanceTimersByTime(500); });
    expect(layoutWrites()).toEqual([{ key: "dock_layout_reading", value: '{"layout":"new-split"}' }]);
  });

  it("flushes a pending layout before the dock API is disposed when leaving within 500ms", async () => {
    const view = render(<DockHost mode="live" components={{}} />);
    await settle();
    fixture.model = { layout: "vertical-split" };
    act(() => { for (const listener of fixture.listeners) listener(); });
    expect(layoutWrites()).toHaveLength(0);
    view.unmount();
    expect(layoutWrites()).toEqual([{ key: "dock_layout_live", value: '{"layout":"vertical-split"}' }]);
    expect(fixture.listeners.size).toBe(0);
    expect(fixture.readsAfterDispose).toBe(0);
    expect(fixture.dockApi).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(layoutWrites()).toHaveLength(1);
  });

  it("captures a last grid mutation even when the library's buffered layout event has not fired", async () => {
    const view = render(<DockHost mode="replay" components={{}} />);
    await settle();
    fixture.model = { layout: "just-moved-tab" };
    // No layout event: the user immediately changes mode after moving a tab.
    view.unmount();
    expect(layoutWrites()).toEqual([{ key: "dock_layout_replay", value: '{"layout":"just-moved-tab"}' }]);
  });

  it("a failed metadata read does not discard a valid saved layout", async () => {
    fixture.failKnownRead = true;
    render(<DockHost mode="reading" components={{}} />);
    await settle();
    expect(fixture.api.fromJSON).toHaveBeenCalledWith({ layout: "saved-split" });
    expect(fixture.api.clear).not.toHaveBeenCalled();
    expect(fixture.listeners.size).toBe(1);
  });

  it("a late restore after unmount neither touches the disposed API nor attaches a listener", async () => {
    fixture.deferReads = true;
    const view = render(<DockHost mode="reading" components={{}} />);
    view.unmount();
    await act(async () => { for (const resolve of fixture.reads) resolve(); });
    expect(fixture.api.fromJSON).not.toHaveBeenCalled();
    expect(fixture.api.toJSON).not.toHaveBeenCalled();
    expect(fixture.listeners.size).toBe(0);
    expect(fixture.writes).toHaveLength(0);
  });

  it("invalid saved JSON falls back to a usable default layout with saving enabled", async () => {
    fixture.saved = "invalid JSON";
    render(<DockHost mode="reading" components={{}} />);
    await settle();
    expect(fixture.api.clear).toHaveBeenCalledTimes(1);
    expect(fixture.api.addPanel).toHaveBeenCalled();
    expect(fixture.listeners.size).toBe(1);
  });
});
