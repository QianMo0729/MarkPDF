import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../core/ui/Icon";
import { testConnection } from "../../data/api/llm";
import {
  codexLoginCancel,
  codexLoginStart,
  codexLogout,
  codexModels,
  codexRateLimits,
  codexShutdown,
  codexStatus,
  describeRateLimits,
  effortFor,
  onCodexLogin,
  usableCodexModels,
  type CodexModel,
  type CodexStatus,
} from "../../platform/codex";
import { useSettings } from "../../stores/settings";

/**
 * Settings → AI 服务 → "ChatGPT 账号（Codex）" (docs/SPEC.md 16.3): shows whether the
 * Codex binary was found, who is signed in, lets the user sign in / out, and
 * picks the model + reasoning effort from Codex's own catalog.
 */

type Probe = { state: "loading" } | { state: "ready"; status: CodexStatus } | { state: "missing"; message: string } | { state: "error"; message: string };

const EFFORT_LABEL: Record<string, string> = { none: "无", minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大", ultra: "Ultra" };

function fmtDate(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function CodexSettings() {
  const settings = useSettings((s) => s.settings);
  const setSetting = useSettings((s) => s.set);
  const [probe, setProbe] = useState<Probe>({ state: "loading" });
  const [models, setModels] = useState<CodexModel[]>([]);
  const [limits, setLimits] = useState<ReturnType<typeof describeRateLimits>>(null);
  const [login, setLogin] = useState<{ loginId: string; authUrl: string } | null>(null);
  const [loginError, setLoginError] = useState("");
  const [pathDraft, setPathDraft] = useState(settings.codexPath);
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "error"; message: string }>({ state: "idle", message: "" });
  const mounted = useRef(true);

  const refresh = useCallback(async (pathOverride: string) => {
    setProbe({ state: "loading" });
    try {
      const status = await codexStatus(pathOverride || undefined);
      if (!mounted.current) return;
      setProbe({ state: "ready", status });
      if (status.account) {
        const [list, raw] = await Promise.all([codexModels(pathOverride || undefined).catch(() => [] as CodexModel[]), codexRateLimits().catch(() => null)]);
        if (!mounted.current) return;
        setModels(usableCodexModels(list));
        setLimits(raw ? describeRateLimits(raw) : null);
      } else {
        setModels([]);
        setLimits(null);
      }
    } catch (e) {
      if (!mounted.current) return;
      const message = String(e instanceof Error ? e.message : e);
      setProbe(/^codex_not_found(?:\s|:|$)/i.test(message) ? { state: "missing", message } : { state: "error", message });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh(settings.codexPath);
    let unlisten: (() => void) | null = null;
    void onCodexLogin((r) => {
      if (!mounted.current) return;
      setLogin(null);
      if (r.success) {
        setLoginError("");
        void refresh(useSettings.getState().settings.codexPath);
      } else setLoginError(r.error || "登录未完成");
    }).then((u) => { unlisten = u; });
    return () => { mounted.current = false; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startLogin = async () => {
    setLoginError("");
    try {
      const r = await codexLoginStart(settings.codexPath || undefined);
      setLogin({ loginId: r.login_id, authUrl: r.auth_url });
      await openUrl(r.auth_url).catch(() => window.open(r.auth_url, "_blank", "noopener,noreferrer"));
    } catch (e) {
      setLoginError(String(e instanceof Error ? e.message : e));
    }
  };
  const cancelLogin = async () => {
    if (login) await codexLoginCancel(login.loginId).catch(() => undefined);
    setLogin(null);
  };
  const logout = async () => {
    await codexLogout().catch((e) => setLoginError(String(e)));
    setModels([]);
    await refresh(settings.codexPath);
  };
  const applyPath = async () => {
    const next = pathDraft.trim();
    await setSetting("codexPath", next);
    await codexShutdown().catch(() => undefined);
    await refresh(next);
  };
  const runTest = async () => {
    setTest({ state: "busy", message: "" });
    try {
      const reply = await testConnection();
      setTest({ state: "ok", message: `连接正常（回复：${reply}）` });
    } catch (e) {
      setTest({ state: "error", message: String(e instanceof Error ? e.message : e) });
    }
  };

  const selected = models.find((m) => m.id === settings.codexModel) ?? models.find((m) => m.isDefault) ?? models[0];
  const effort = effortFor(selected, settings.codexEffort);
  const account = probe.state === "ready" ? probe.status.account : null;

  return (
    <div className="codex-settings">
      <p className="caption">
        通过本机的 Codex CLI 用你的 ChatGPT 账号登录，翻译、解释和转写纠错走订阅额度，不需要 API Key。登录、令牌和额度都由 Codex 自己管理，MarkPDF 不保存任何凭据。
      </p>
      <p className="caption">
        OpenAI 目前允许第三方工具通过 Codex 登录使用订阅额度，但条款没有明文承诺，政策可能变化；每次请求会带上 Codex 的工具上下文（约 2 万 token），逐句纠错会较快消耗额度。
      </p>

      <div className="settings-row">
        <span className="body">Codex CLI</span>
        <span className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {probe.state === "loading" && <span className="caption">检测中…</span>}
          {probe.state === "ready" && <span className="caption">已找到 {probe.status.info.version}<br /><span className="text3">{probe.status.info.path}</span></span>}
          {probe.state === "missing" && <span className="caption" style={{ color: "var(--record)" }}>没有找到 codex 可执行文件</span>}
          {probe.state === "error" && <span className="caption" style={{ color: "var(--record)" }}>{probe.message}</span>}
          <button className="btn btn-text toolbar-small" onClick={() => void refresh(settings.codexPath)}>重新检测</button>
        </span>
      </div>
      {probe.state === "missing" && (
        <p className="caption">
          安装 Codex CLI 后再来：在终端运行 <code>npm install -g @openai/codex</code>，或把已安装的 codex.exe 路径填在下方。安装说明见 developers.openai.com/codex/cli。
        </p>
      )}
      <div className="settings-row">
        <span className="body">codex 路径（可选）</span>
        <span className="row" style={{ gap: 8 }}>
          <input className="input settings-input" aria-label="codex 路径" placeholder="留空则自动查找 PATH、npm 全局目录" value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} />
          <button className="btn btn-outlined" disabled={pathDraft.trim() === settings.codexPath} onClick={() => void applyPath()}>应用</button>
        </span>
      </div>

      <div className="settings-row">
        <span className="body">ChatGPT 账号</span>
        <span className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {account?.type === "chatgpt" && (
            <span className="caption">{account.email ?? "已登录"}{account.planType ? ` · ${account.planType}` : ""}</span>
          )}
          {account && account.type !== "chatgpt" && <span className="caption">Codex 当前用 {account.type} 登录，请退出后改用 ChatGPT 账号</span>}
          {probe.state === "ready" && !account && !login && <span className="caption">未登录</span>}
          {login ? (
            <>
              <span className="caption">已在浏览器打开登录页，完成后自动返回…</span>
              <button className="btn btn-text toolbar-small" onClick={() => void openUrl(login.authUrl)}>重新打开</button>
              <button className="btn btn-outlined" onClick={() => void cancelLogin()}>取消</button>
            </>
          ) : account ? (
            <button className="btn btn-outlined" onClick={() => void logout()}>退出登录</button>
          ) : (
            <button className="btn btn-filled" disabled={probe.state !== "ready"} onClick={() => void startLogin()}>
              <Icon name="login" size={18} />登录 ChatGPT
            </button>
          )}
        </span>
      </div>
      {loginError && <p className="caption" style={{ color: "var(--record)" }}>{loginError}</p>}
      {limits && (
        <p className="caption">
          订阅额度：{limits.windowMins && limits.windowMins >= 10000 ? "本周" : "当前窗口"}已用 {Math.round(limits.usedPercent)}%
          {limits.resetsAt ? `，${fmtDate(limits.resetsAt)} 重置` : ""}
        </p>
      )}

      {account && (
        <>
          <div className="settings-row">
            <span className="body">模型</span>
            <select className="input settings-input" aria-label="Codex 模型" value={selected?.id ?? ""} onChange={(e) => void setSetting("codexModel", e.target.value)}>
              {models.length === 0 && <option value="">（正在读取模型列表…）</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}{m.isDefault ? "（默认）" : ""}</option>
              ))}
            </select>
          </div>
          {selected?.description && <p className="caption settings-endpoint">{selected.description}</p>}
          <div className="settings-row">
            <span className="body">推理强度</span>
            <select className="input settings-input" aria-label="推理强度" value={effort} onChange={(e) => void setSetting("codexEffort", e.target.value)}>
              {(selected?.supportedReasoningEfforts ?? []).map((o) => (
                <option key={o.reasoningEffort} value={o.reasoningEffort}>
                  {EFFORT_LABEL[o.reasoningEffort] ?? o.reasoningEffort}{o.reasoningEffort === selected?.defaultReasoningEffort ? "（模型默认）" : ""}
                </option>
              ))}
            </select>
          </div>
          {selected && <p className="caption settings-endpoint">{selected.supportedReasoningEfforts.find((o) => o.reasoningEffort === effort)?.description ?? ""}</p>}
          <div className="settings-row">
            <span className="body">测试连接</span>
            <span className="row" style={{ gap: 8 }}>
              {test.state !== "idle" && test.state !== "busy" && (
                <span className="caption" style={{ color: test.state === "ok" ? "var(--mark-homework)" : "var(--record)" }}>{test.message}</span>
              )}
              <button className="btn btn-outlined" disabled={test.state === "busy" || !selected} onClick={() => void runTest()}>
                {test.state === "busy" ? "测试中…" : "测试连接"}
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
