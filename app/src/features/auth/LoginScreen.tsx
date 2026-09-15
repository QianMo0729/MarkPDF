import { useNavigate } from "react-router";
import { S } from "../../core/strings";

/** Email-code login arrives with the backend in M9 (docs/SPEC.md 6.4.1). */
export function LoginScreen() {
  const navigate = useNavigate();
  return (
    <div className="empty" style={{ height: "100%" }}>
      <div className="col" style={{ width: 360, maxWidth: "100%", gap: 12, alignItems: "stretch" }}>
        <div className="display" style={{ color: "var(--text)" }}>
          {S.app}
        </div>
        <div className="body">{S.tagline}</div>
        <input className="input" placeholder="邮箱" disabled />
        <button className="btn btn-filled" disabled>
          发送验证码
        </button>
        <div className="caption">账号与同步在后端上线后开放。</div>
        <button className="btn btn-text" onClick={() => navigate("/")}>
          暂不登录，本地使用
        </button>
      </div>
    </div>
  );
}
