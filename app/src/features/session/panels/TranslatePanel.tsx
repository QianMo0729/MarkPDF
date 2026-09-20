import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../../../core/strings";
import { Icon } from "../../../core/ui/Icon";
import { toast } from "../../../core/ui/Toast";
import { isLlmConfigured, LlmNotConfiguredError } from "../../../data/api/llm";
import { getDeckPage } from "../../../data/db/repos/decks";
import { copyText } from "../../../platform/clipboard";
import { useSettings, type TranslationMode } from "../../../stores/settings";
import { useNoteEditor } from "../controllers/noteEditor";
import { runTextAction, useTranslateStore, type TranslateAction } from "../controllers/translate";
import { useSessionUi, useViewerState } from "../sessionStore";
import "./panels.css";
import "./translate.css";

interface KindUi {
  icon: string;
  action: string;
  busy: string;
  copy: string;
  unconfigured: string;
  failed: (m: string) => string;
}

/** The two panels share one implementation and differ only in copy and prompt (docs/SPEC.md 6.5.10). */
const KIND_UI: Record<TranslateAction, KindUi> = {
  translate: {
    icon: "translate",
    action: S.tools.translate,
    busy: "翻译中…",
    copy: "复制译文",
    unconfigured: "翻译需要先配置 AI 服务",
    failed: S.errors.translate,
  },
  explain: {
    icon: "lightbulb",
    action: S.tools.explain,
    busy: "解释中…",
    copy: "复制解释",
    unconfigured: "解释需要先配置 AI 服务",
    failed: S.errors.explain,
  },
};

/** Translate locally by default, with an explicit option to use the configured AI. */
export function TranslatePanel(props: IDockviewPanelProps) {
  return <LlmTextPanel {...props} kind="translate" />;
}

/** Explain selected text with the configured LLM. */
export function ExplainPanel(props: IDockviewPanelProps) {
  return <LlmTextPanel {...props} kind="explain" />;
}

function LlmTextPanel({ kind, api }: IDockviewPanelProps & { kind: TranslateAction }) {
  const ui = KIND_UI[kind];
  const navigate = useNavigate();
  const target = useSettings((s) => s.settings.translateTarget);
  const mode = useSettings((s) => s.settings.translationMode);
  const setSetting = useSettings((s) => s.set);
  const configured = useSettings((s) => isLlmConfigured(s.settings));
  const deckId = useSessionUi((s) => s.deckId);
  const page = useViewerState().currentPage;
  const request = useTranslateStore((s) => s.request);
  const history = useTranslateStore((s) => s.history[kind]);
  const remember = useTranslateStore((s) => s.remember);
  const clear = useTranslateStore((s) => s.clear);

  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [resultSource, setResultSource] = useState("");
  const [resultEngine, setResultEngine] = useState<TranslationMode | undefined>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lastNonce = useRef(0);
  const retryEngine = useRef<TranslationMode>(mode);

  useEffect(() => () => { abort.current?.abort(); lastNonce.current = 0; }, []);

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
  };

  const pageContext = async () => {
    if (!deckId) return undefined;
    const row = await getDeckPage(deckId, page);
    return row?.text || undefined;
  };

  const run = async (text: string, selectedMode: TranslationMode = mode) => {
    const t = text.trim();
    if (!t) return;
    const engine = kind === "explain" ? "ai" : selectedMode;
    retryEngine.current = engine;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setProgress("");
    setError(null);
    setResult("");
    try {
      if (engine === "ai" && !isLlmConfigured()) throw new LlmNotConfiguredError();
      const ctx = kind === "explain" ? await pageContext() : undefined;
      const reply = await runTextAction(kind, t, target, engine, {
        signal: ctrl.signal, pageText: ctx,
        onProgress: (message) => { if (!ctrl.signal.aborted) setProgress(message); },
      });
      if (ctrl.signal.aborted) return;
      setResult(reply);
      setResultSource(t);
      setResultEngine(engine);
      remember(kind, { source: t, result: reply, engine });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  };

  // Requests arriving from the selection toolbar; only the panel for that action reacts.
  useEffect(() => {
    if (!request || request.action !== kind || request.nonce === lastNonce.current) return;
    lastNonce.current = request.nonce;
    api.setActive();
    setSource(request.text);
    setResult("");
    void run(request.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const addToNotes = async () => {
    const quote = `> ${resultSource.trim().replace(/\n+/g, " ")}\n> ${result.trim().replace(/\n+/g, " ")}`;
    try {
      await useNoteEditor.getState().appendToCurrentNote(quote);
      toast(S.toast.saved);
    } catch (error) {
      toast(S.errors.generic(String(error)), "error");
    }
  };

  return (
    <div className="panel translate-panel">
      <div className="panel-head" style={{ justifyContent: "space-between" }}>
        <div className="segmented" role="radiogroup" aria-label="目标语言">
          {(["zh", "en"] as const).map((t) => (
            <button key={t} role="radio" disabled={busy} aria-checked={target === t} className={target === t ? "selected" : ""} onClick={() => { setResult(""); void setSetting("translateTarget", t); }}>
              {t === "zh" ? S.settings.langZh : S.settings.langEn}
            </button>
          ))}
        </div>
        <button
          className="btn btn-text toolbar-small"
          onClick={() => {
            cancel();
            setSource("");
            setResult("");
            setError(null);
            clear(kind);
          }}
        >
          清空
        </button>
      </div>
      <div className="panel-body scroll-y translate-body">
        {kind === "translate" && (
          <div className="translate-engine">
            <div className="segmented" role="radiogroup" aria-label="翻译方式">
              {(["local", "ai"] as const).map((value) => (
                <button key={value} role="radio" disabled={busy} aria-checked={mode === value} className={mode === value ? "selected" : ""}
                  onClick={() => { setError(null); void setSetting("translationMode", value); }}>
                  {value === "local" ? "本地离线" : "AI 服务"}
                </button>
              ))}
            </div>
            <span className="caption">{mode === "local" ? "首次使用会下载中英模型，之后可离线翻译。" : "选中文本将发送到设置中的 AI 服务。"}</span>
          </div>
        )}
        {!configured && (kind === "explain" || mode === "ai") && (
          <div className="translate-notice">
            <Icon name={ui.icon} size={20} /><span className="body-small">{ui.unconfigured}</span>
            <button className="btn btn-text toolbar-small" onClick={() => navigate("/settings")}>去设置</button>
          </div>
        )}
        <textarea
          className="translate-source"
          aria-label={kind === "translate" ? "待翻译文本" : "待解释文本"}
          placeholder="粘贴或从课件选中文本…"
          value={source}
          disabled={busy}
          onChange={(e) => { setSource(e.target.value); setResult(""); setError(null); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void run(source);
          }}
          rows={4}
        />
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-filled" disabled={!source.trim() || busy} onClick={() => void run(source)}>
            {busy ? ui.busy : ui.action}
          </button>
          {kind === "translate" && mode === "local" && (
            <button className="btn btn-outlined" disabled={!source.trim() || busy} onClick={() => void run(source, "ai")}>
              单次用 AI 翻译
            </button>
          )}
          {busy && <button className="btn btn-text toolbar-small" onClick={cancel}>取消</button>}
        </div>
        {error && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="body-small" style={{ color: "var(--record)" }}>
              {ui.failed(error)}
            </span>
            <button className="btn btn-text toolbar-small" onClick={() => void run(source, retryEngine.current)}>
              {S.course.retry}
            </button>
            <button className="btn btn-text toolbar-small" onClick={() => navigate("/settings")}>
              去设置
            </button>
          </div>
        )}
        {busy && !result && (
          <div className="col" style={{ gap: 6 }} role="status" aria-live="polite">
            {progress && <span className="caption">{progress}</span>}
            <span className="skeleton" style={{ width: "90%" }} />
            <span className="skeleton" style={{ width: "75%" }} />
            <span className="skeleton" style={{ width: "60%" }} />
          </div>
        )}
        {result && (
          <>
            {resultEngine && <span className="caption">{resultEngine === "local" ? "本地翻译" : "AI 服务"}</span>}
            <div className="body translate-result">{result}</div>
            <div className="row" style={{ gap: 4 }}>
              <button
                className="btn btn-text toolbar-small"
                onClick={async () => {
                  await copyText(result);
                  toast("已复制");
                }}
              >
                {ui.copy}
              </button>
              <button className="btn btn-text toolbar-small" onClick={() => void addToNotes()}>
                {S.tools.addToNotes}
              </button>
            </div>
          </>
        )}
        {history.length > 0 && (
          <details className="translate-history">
            <summary className="caption">历史（{history.length}）</summary>
            {history.map((h) => (
              <button
                key={h.id}
                className="translate-history-item"
                onClick={() => {
                  cancel();
                  setError(null);
                  setSource(h.source);
                  setResult(h.result);
                  setResultSource(h.source);
                  setResultEngine(h.engine);
                }}
              >
                <span className="body-small">{h.source.slice(0, 40)}</span>
              </button>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
