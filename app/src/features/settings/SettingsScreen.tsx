import { useState } from "react";
import { useNavigate } from "react-router";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect } from "react";
import { useLayoutClass } from "../../core/layout/breakpoints";
import { HIGHLIGHT_COLORS, INK_COLORS, TEXT_BOX_FILL_COLORS } from "../../core/palette";
import { S } from "../../core/strings";
import { Icon } from "../../core/ui/Icon";
import { toast } from "../../core/ui/Toast";
import { getLlmProtocol, LLM_FORMAT_LABELS, resolveLlmEndpoint, testConnection } from "../../data/api/llm";
import { LocalTranslationSettings } from "../../data/translation/LocalTranslationSettings";
import { clearThumbnailCache } from "../../domain/deletion";
import { useSettings, type LlmApiFormat, type Settings } from "../../stores/settings";
import { CodexSettings } from "./CodexSettings";
import "./settings.css";

type GroupId = "account" | "transcription" | "ai" | "annotations" | "reading" | "storage" | "sync" | "appearance" | "shortcuts" | "about";

const GROUPS: { id: GroupId; label: string; icon: string }[] = [
  { id: "account", label: S.settings.account, icon: "person" },
  { id: "transcription", label: S.settings.transcription, icon: "subtitles" },
  { id: "ai", label: "翻译与 AI", icon: "translate" },
  { id: "annotations", label: S.settings.annotations, icon: "format_ink_highlighter" },
  { id: "reading", label: S.settings.readingGroup, icon: "menu_book" },
  { id: "storage", label: S.settings.storage, icon: "storage" },
  { id: "sync", label: S.settings.sync, icon: "sync" },
  { id: "appearance", label: S.settings.appearance, icon: "palette" },
  { id: "shortcuts", label: S.settings.shortcuts, icon: "keyboard" },
  { id: "about", label: S.settings.about, icon: "info" },
];


export function SettingsScreen() {
  const layout = useLayoutClass();
  const [active, setActive] = useState<GroupId>("account");
  const twoCol = layout === "expanded";

  return (
    <div className={`settings ${twoCol ? "two-col" : "one-col"}`}>
      {twoCol && (
        <nav className="settings-nav" aria-label={S.settings.title}>
          {GROUPS.map((g) => (
            <button key={g.id} className={`settings-nav-item ${active === g.id ? "active" : ""}`} onClick={() => setActive(g.id)}>
              <Icon name={g.icon} size={20} />
              {g.label}
            </button>
          ))}
        </nav>
      )}
      <div className="settings-content">
        {(twoCol ? GROUPS.filter((g) => g.id === active) : GROUPS).map((g) => (
          <section key={g.id} className="settings-group" aria-labelledby={`settings-${g.id}`}>
            <h2 id={`settings-${g.id}`} className="title">
              {g.label}
            </h2>
            <Group id={g.id} />
          </section>
        ))}
      </div>
    </div>
  );
}

function Group({ id }: { id: GroupId }) {
  switch (id) {
    case "account":
      return <AccountGroup />;
    case "transcription":
      return <TranscriptionGroup />;
    case "ai":
      return <AiGroup />;
    case "annotations":
      return <AnnotationsGroup />;
    case "reading":
      return <ReadingGroup />;
    case "storage":
      return <StorageGroup />;
    case "sync":
      return <SyncGroup />;
    case "appearance":
      return <AppearanceGroup />;
    case "shortcuts":
      return <ShortcutsGroup />;
    case "about":
      return <AboutGroup />;
  }
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="col" style={{ gap: 2 }}>
        <span className="body">{label}</span>
        {hint && <span className="caption">{hint}</span>}
      </div>
      <div className="row" style={{ gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? "selected" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  );
}

function useSettingField<K extends keyof Settings>(key: K): [Settings[K], (v: Settings[K]) => void] {
  const value = useSettings((s) => s.settings[key]);
  const set = useSettings((s) => s.set);
  return [value, (v) => void set(key, v)];
}

function AccountGroup() {
  const [localMode] = useSettingField("localMode");
  return (
    <Row label={localMode ? S.settings.localMode : "已登录"} hint={localMode ? S.settings.syncUnavailable : undefined}>
      {localMode && (
        <button className="btn btn-outlined" disabled title={S.settings.syncUnavailable}>
          {S.settings.loginToSync}
        </button>
      )}
    </Row>
  );
}

function TranscriptionGroup() {
  const navigate = useNavigate();
  const [asrEnabled, setAsr] = useSettingField("asrEnabled");
  const [lang, setLang] = useSettingField("langMode");
  return (
    <>
      <Row label={S.settings.liveAsr}>
        <Toggle checked={asrEnabled} onChange={setAsr} label={S.settings.liveAsr} />
      </Row>
      <Row label={S.settings.language}>
        <Segmented
          value={lang}
          onChange={setLang}
          options={[
            { value: "auto", label: S.settings.langAuto },
            { value: "zh", label: S.settings.langZh },
            { value: "en", label: S.settings.langEn },
          ]}
        />
      </Row>
      <Row label="转写模型">
        <button className="btn btn-outlined" onClick={() => navigate("/settings/asr")}>
          管理模型
        </button>
      </Row>
    </>
  );
}

function AiGroup() {
  const [baseUrl, setBaseUrl] = useSettingField("llmBaseUrl");
  const [apiKey, setApiKey] = useSettingField("llmApiKey");
  const [model, setModel] = useSettingField("llmModel");
  const [target, setTarget] = useSettingField("translateTarget");
  const [mode, setMode] = useSettingField("translationMode");
  const [format, setFormat] = useSettingField("llmApiFormat");
  const [provider, setProvider] = useSettingField("llmProvider");
  let endpoint = "";
  try { if (baseUrl.trim()) endpoint = resolveLlmEndpoint(baseUrl, getLlmProtocol(baseUrl, format)); } catch { /* validate when testing */ }
  return (
    <>
      <Row label="默认翻译方式" hint="本地翻译使用中英模型。需要 AI 时，可在翻译面板单次使用或切换默认方式。">
        <Segmented value={mode} onChange={setMode} options={[{ value: "local", label: "本地离线" }, { value: "ai", label: "AI 服务" }]} />
      </Row>
      <Row label={S.settings.translateTarget}>
        <Segmented
          value={target}
          onChange={setTarget}
          options={[
            { value: "zh", label: S.settings.langZh },
            { value: "en", label: S.settings.langEn },
          ]}
        />
      </Row>
      <LocalTranslationSettings />
      <h3 className="settings-subtitle">AI 服务</h3>
      <p className="caption">转写面板的“上下文纠错”默认关闭。开启后使用这里配置的 AI 服务，结合前后句修正同音词等转写错误，并保留原始转写供核对。纠错与实时翻译可独立开关。</p>
      <Row label="接入方式" hint="自定义 API：填写 OpenAI / Claude 兼容接口。ChatGPT 账号：用本机 Codex CLI 登录，走订阅额度。">
        <Segmented value={provider} onChange={setProvider} options={[{ value: "custom", label: "自定义 API" }, { value: "codex", label: "ChatGPT 账号" }]} />
      </Row>
      {provider === "codex" && <CodexSettings />}
      {provider === "custom" && <>
      <p className="caption">按接口要求选择发送格式，服务地址、API Key 和模型由你填写。OpenAI 格式兼容 Codex；采样参数使用服务默认值。</p>
      <Row label="发送格式">
        <select className="input settings-input" aria-label="发送格式" value={format === "claude-messages" ? "claude-messages" : "openai"} onChange={(e) => setFormat(e.target.value as LlmApiFormat)}>
          {(Object.entries(LLM_FORMAT_LABELS) as [LlmApiFormat, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Row>
      <Row label={S.settings.aiBaseUrl} hint="可填写服务根地址、含 /v1 的地址或完整接口路径。">
        <input className="input settings-input" aria-label={S.settings.aiBaseUrl} placeholder="https://your-service.example/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </Row>
      {endpoint && <p className="caption settings-endpoint">请求地址：{endpoint}</p>}
      <Row label={S.settings.aiKey}>
        <input className="input settings-input" aria-label={S.settings.aiKey} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
      </Row>
      <Row label={S.settings.aiModel}>
        <input className="input settings-input" aria-label={S.settings.aiModel} placeholder="填写服务商提供的模型 ID" value={model} onChange={(e) => setModel(e.target.value)} />
      </Row>
      <Row label={S.settings.aiTest}>
        <TestConnectionButton disabled={!baseUrl.trim() || !apiKey.trim() || !model.trim()} />
      </Row>
      </>}
    </>
  );
}

function TestConnectionButton({ disabled }: { disabled: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  const run = async () => {
    setState("busy");
    try {
      await testConnection();
      setState("ok");
      setMessage(S.settings.aiOk);
    } catch (e) {
      setState("error");
      setMessage(String(e instanceof Error ? e.message : e));
    }
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      {state !== "idle" && state !== "busy" && (
        <span className="caption" style={{ color: state === "ok" ? "var(--mark-homework)" : "var(--record)" }}>
          {message}
        </span>
      )}
      <button className="btn btn-outlined" onClick={() => void run()} disabled={disabled || state === "busy"}>
        {state === "busy" ? "测试中…" : S.settings.aiTest}
      </button>
    </div>
  );
}

function AnnotationsGroup() {
  const [hl, setHl] = useSettingField("highlightColor");
  const [ink, setInk] = useSettingField("inkColor");
  const [width, setWidth] = useSettingField("inkWidth");
  const [font, setFont] = useSettingField("textBoxFontSize");
  const [textColor, setTextColor] = useSettingField("textColor");
  const [border, setBorder] = useSettingField("textBoxBorderColor");
  const [fill, setFill] = useSettingField("textBoxFillColor");
  return (
    <>
      <Row label={S.settings.defaultHighlight}>
        <Swatches colors={HIGHLIGHT_COLORS} value={hl} onChange={setHl} />
      </Row>
      <Row label={S.settings.defaultInk}>
        <Swatches colors={INK_COLORS} value={ink} onChange={setInk} />
        <Segmented
          value={String(width)}
          onChange={(v) => setWidth(Number(v))}
          options={[1, 2, 4, 8].map((w) => ({ value: String(w), label: `${w}` }))}
        />
      </Row>
      <Row label={S.settings.textBoxFont}>
        <Segmented
          value={String(font)}
          onChange={(v) => setFont(Number(v))}
          options={[0, 12, 16, 20, 24, 32].map((f) => ({ value: String(f), label: f === 0 ? "自动" : `${f}` }))}
        />
      </Row>
      <Row label={S.settings.textBoxColor}>
        <Swatches colors={INK_COLORS} value={textColor} onChange={setTextColor} />
      </Row>
      <Row label={S.settings.textBoxBorder}>
        <Swatches colors={INK_COLORS} value={border} allowNone onChange={setBorder} />
      </Row>
      <Row label={S.settings.textBoxFill}>
        <Swatches colors={TEXT_BOX_FILL_COLORS} value={fill} allowNone onChange={setFill} />
      </Row>
    </>
  );
}

function Swatches({ colors, value, allowNone, onChange }: { colors: string[]; value: string; allowNone?: boolean; onChange: (c: string) => void }) {
  return (
    <div className="row" style={{ gap: 6 }} role="radiogroup">
      {allowNone && (
        <button role="radio" aria-checked={value === ""} aria-label={S.tools.none} title={S.tools.none} className={`color-swatch small none ${value === "" ? "selected" : ""}`} onClick={() => onChange("")} />
      )}
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={c.toLowerCase() === value.toLowerCase()}
          aria-label={c}
          className={`color-swatch small ${c.toLowerCase() === value.toLowerCase() ? "selected" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function ReadingGroup() {
  const [view, setView] = useSettingField("viewMode");
  const [zoom, setZoom] = useSettingField("zoomMode");
  return (
    <>
      <Row label={S.settings.defaultView}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "single", label: S.tools.single },
            { value: "continuous", label: S.tools.continuous },
          ]}
        />
      </Row>
      <Row label={S.settings.defaultZoom}>
        <Segmented
          value={zoom === "page-fit" ? "page-fit" : "page-width"}
          onChange={setZoom}
          options={[
            { value: "page-width", label: S.tools.fitWidth },
            { value: "page-fit", label: S.tools.fitPage },
          ]}
        />
      </Row>
    </>
  );
}

function StorageGroup() {
  const [del, setDel] = useSettingField("deleteWavAfterUpload");
  return (
    <>
      <Row label={S.settings.deleteWav}>
        <Toggle checked={del} onChange={setDel} label={S.settings.deleteWav} />
      </Row>
      <Row label={S.settings.clearThumbs}>
        <button
          className="btn btn-outlined"
          onClick={() => {
            clearThumbnailCache()
              .then(() => toast(S.settings.thumbsCleared))
              .catch((e) => toast(S.errors.generic(String(e)), "error"));
          }}
        >
          {S.settings.clearThumbs}
        </button>
      </Row>
    </>
  );
}

function SyncGroup() {
  return <Row label={S.settings.localMode} hint={S.settings.syncUnavailable} />;
}

function AppearanceGroup() {
  const [theme, setTheme] = useSettingField("theme");
  return (
    <Row label={S.settings.appearance}>
      <Segmented
        value={theme}
        onChange={setTheme}
        options={[
          { value: "system", label: S.settings.themeSystem },
          { value: "light", label: S.settings.themeLight },
          { value: "dark", label: S.settings.themeDark },
        ]}
      />
    </Row>
  );
}

const SHORTCUTS: [string, string][] = [
  ["← / →，PageUp / PageDown", "上一页 / 下一页"],
  ["Space、K", "播放 / 暂停"],
  ["J / L", "−10 s / +10 s"],
  ["V / H / D / T / E", "选择 / 高亮 / 绘制 / 添加文本 / 擦除"],
  ["Ctrl + Z / Ctrl + Shift + Z", "撤销 / 重做标注"],
  ["Ctrl + = / − / 0", "放大 / 缩小 / 适应宽度"],
  ["Ctrl + 1 … 7", "切换面板"],
  ["Ctrl + E", "循环 实时 → 源码 → 阅读"],
  ["Ctrl + Shift + T", "插入时间戳"],
  ["Ctrl + B / I", "加粗 / 斜体"],
  ["Ctrl + \\", "收起 / 展开右侧面板"],
  ["Ctrl + Shift + R", "开始 / 结束录音"],
  ["F1 / F2 / F3", "重点 / 没听懂 / 作业"],
  ["Ctrl + F", "搜索"],
  ["Ctrl + Shift + E", "导出带标注的 PDF"],
  ["Esc", "退出编辑 / 取消选择 / 关闭弹层"],
];

function ShortcutsGroup() {
  return (
    <table className="shortcut-table">
      <tbody>
        {SHORTCUTS.map(([k, v]) => (
          <tr key={k}>
            <td className="body-small mono">{k}</td>
            <td className="body-small text2">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AboutGroup() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("dev"));
  }, []);
  return <Row label={S.settings.version}>{version}</Row>;
}
