import { create } from "zustand";

interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "error";
}

interface ToastStore {
  items: ToastItem[];
  show: (text: string, kind?: ToastItem["kind"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  items: [],
  show: (text, kind = "info") => {
    const id = nextId++;
    set((s) => ({ items: [...s.items, { id, text, kind }] }));
    window.setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 3200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** Call from anywhere (repos, controllers) to show a transient message. */
export function toast(text: string, kind: ToastItem["kind"] = "info"): void {
  useToasts.getState().show(text, kind);
}

export function ToastHost() {
  const items = useToasts((s) => s.items);
  if (!items.length) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
