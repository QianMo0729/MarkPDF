import type { IDockviewPanelProps } from "dockview-react";
import { Icon } from "../../../core/ui/Icon";
import { useSettings } from "../../../stores/settings";
import { useSessionUi } from "../sessionStore";
import "./panels.css";

/** Summary states (docs/SPEC.md 6.5.12). Generation itself needs the server (M11). */
export function SummaryPanel(_props: IDockviewPanelProps) {
  const mode = useSessionUi((s) => s.mode);
  const localMode = useSettings((s) => s.settings.localMode);

  if (mode === "live") {
    return (
      <div className="empty" style={{ height: "100%" }}>
        <div className="subtitle" style={{ color: "var(--text)" }}>
          结束录音后可以生成总结
        </div>
        <div className="body-small col" style={{ gap: 2 }}>
          <span>每页要点</span>
          <span>关键概念</span>
          <span>你标记没听懂的地方</span>
        </div>
      </div>
    );
  }
  return (
    <div className="empty" style={{ height: "100%" }}>
      <Icon name="auto_awesome" size={40} />
      <div className="subtitle" style={{ color: "var(--text)" }}>
        还没有总结
      </div>
      <div className="body">AI 会根据幻灯片、录音转写、你的笔记和标注，按页整理这节课。</div>
      <button className="btn btn-filled" disabled>
        生成总结
      </button>
      <div className="caption">{localMode ? "生成总结需要登录" : "需要先上传录音"}</div>
    </div>
  );
}
