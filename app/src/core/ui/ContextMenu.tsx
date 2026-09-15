import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { Icon } from "./Icon";

export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface Anchor {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * Right-click / "more" menus. Usage:
 *   const menu = useContextMenu();
 *   <div onContextMenu={(e) => menu.open(e, items)} />  {menu.element}
 */
export function useContextMenu() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const open = useCallback((e: MouseEvent | { clientX: number; clientY: number }, items: MenuItem[]) => {
    if ("preventDefault" in e) e.preventDefault();
    setAnchor({ x: e.clientX, y: e.clientY, items });
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  const element = anchor ? <Menu anchor={anchor} onClose={close} /> : null;
  return { open, close, element, isOpen: anchor !== null };
}

function Menu({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(anchor.x, window.innerWidth - r.width - 8);
    const y = Math.min(anchor.y, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {anchor.items.map((item, i) => (
        <button
          key={i}
          role="menuitem"
          className={item.danger ? "danger" : ""}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.icon && <Icon name={item.icon} size={18} />}
          {item.label}
        </button>
      ))}
    </div>
  );
}
