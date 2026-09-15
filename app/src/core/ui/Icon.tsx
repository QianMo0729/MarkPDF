import type { CSSProperties } from "react";

interface IconProps {
  /** Material Symbols ligature name, e.g. "mic", "edit_note". */
  name: string;
  size?: number;
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 20, filled, className, style }: IconProps) {
  const cls = ["material-symbols-rounded", filled ? "filled" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls} style={{ fontSize: size, ...style }} aria-hidden="true">
      {name}
    </span>
  );
}
