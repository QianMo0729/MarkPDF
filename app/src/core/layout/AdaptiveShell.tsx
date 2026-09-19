import { Link, Outlet, useLocation, useSearchParams } from "react-router";
import { S } from "../strings";
import { Icon } from "../ui/Icon";
import { RecordingBanner } from "../../features/session/widgets/RecordingBanner";
import { isMac } from "../../platform/os";
import { useLayoutClass } from "./breakpoints";
import "./shell.css";

interface NavItem {
  key: "courses" | "recent" | "settings";
  label: string;
  icon: string;
  to: string;
}

const ITEMS: NavItem[] = [
  { key: "courses", label: S.nav.courses, icon: "menu_book", to: "/" },
  { key: "recent", label: S.nav.recent, icon: "history", to: "/?tab=recent" },
  { key: "settings", label: S.nav.settings, icon: "settings", to: "/settings" },
];

function useActiveKey(): NavItem["key"] {
  const loc = useLocation();
  const [params] = useSearchParams();
  if (loc.pathname.startsWith("/settings")) return "settings";
  if (loc.pathname === "/" && params.get("tab") === "recent") return "recent";
  return "courses";
}

/** Rail (expanded) or bottom bar (medium / compact) around the library, course and settings screens. */
export function AdaptiveShell() {
  const layout = useLayoutClass();
  const active = useActiveKey();
  const rail = layout === "expanded";

  const nav = (
    <nav className={rail ? "nav-rail" : "nav-bar"} aria-label="主导航">
      {ITEMS.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          className={`nav-item ${active === item.key ? "active" : ""}`}
          aria-current={active === item.key ? "page" : undefined}
        >
          <Icon name={item.icon} size={24} filled={active === item.key} />
          <span className="caption">{item.label}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <div className={`shell ${rail ? "shell-rail" : "shell-bar"}`}>
      {isMac && <div className="window-drag-strip" data-tauri-drag-region />}
      {rail && nav}
      <main className="shell-content">
        <RecordingBanner />
        <Outlet />
      </main>
      {!rail && nav}
    </div>
  );
}
