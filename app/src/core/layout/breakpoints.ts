import { create } from "zustand";

export type LayoutClass = "compact" | "medium" | "expanded";

export function layoutClassFor(width: number): LayoutClass {
  if (width < 600) return "compact";
  if (width < 1024) return "medium";
  return "expanded";
}

interface LayoutStore {
  width: number;
  layoutClass: LayoutClass;
  setWidth: (w: number) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  width: typeof window !== "undefined" ? window.innerWidth : 1280,
  layoutClass: layoutClassFor(typeof window !== "undefined" ? window.innerWidth : 1280),
  setWidth: (w) => set({ width: w, layoutClass: layoutClassFor(w) }),
}));

export function useLayoutClass(): LayoutClass {
  return useLayoutStore((s) => s.layoutClass);
}

/** Call once at app start; keeps the store in sync with the window. */
export function installLayoutListener(): () => void {
  const update = () => useLayoutStore.getState().setWidth(window.innerWidth);
  update();
  window.addEventListener("resize", update);
  return () => window.removeEventListener("resize", update);
}
