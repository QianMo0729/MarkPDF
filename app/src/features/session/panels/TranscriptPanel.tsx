import type { IDockviewPanelProps } from "dockview-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../../../core/strings";
import { Icon } from "../../../core/ui/Icon";
import { toast } from "../../../core/ui/Toast";
import { fmtClock } from "../../../core/utils/time";
import { select } from "../../../data/db/client";
import { useLiveQuery } from "../../../data/db/live";
import type { TranscriptSegmentRow } from "../../../data/db/schema";
import { useSettings } from "../../../stores/settings";
import { usePlayback } from "../controllers/playback";
import { useRecording } from "../controllers/recording";
import { useTranscriptTranslation } from "../controllers/useTranscriptTranslation";
import { useTranscriptCorrection } from "../controllers/useTranscriptCorrection";
import { useSharedTranscriptTranslation } from "../controllers/TranscriptTranslationContext";
import { useSessionUi } from "../sessionStore";
import { asrChipFor } from "../widgets/TransportBarLive";
import "./panels.css";
import "./transcript.css";

/**
 * Transcript list (docs/SPEC.md 6.5.11). Segments arrive from the on-device
 * engine (M7) or the server (M10); until then this shows the empty states.
 */
export function TranscriptPanel(props: IDockviewPanelProps) {
  const mode = useSessionUi((s) => s.mode);
  const sessionId = useSessionUi((s) => s.sessionId);
  const rec = useRecording();
  const partial = mode === "live" && rec.sessionId === sessionId ? rec.partial : "";
  const asr = rec.sessionId === sessionId ? rec.asr : "off";
  const pb = usePlayback();
  const navigate = useNavigate();
  const localMode = useSettings((s) => s.settings.localMode);
  const translationEnabled = useSettings((s) => s.settings.transcriptTranslationEnabled);
  const correctionEnabled = useSettings((s) => s.settings.transcriptCorrectionEnabled);
  const translationMode = useSettings((s) => s.settings.translationMode);
  const translationTarget = useSettings((s) => s.settings.translateTarget);
  const setSetting = useSettings((s) => s.set);
  const sharedTranslation = useSharedTranscriptTranslation();
  const [query, setQuery] = useState("");
  const [showTranslation, setShowTranslation] = useState(true);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef(true);
  const lastScrollTop = useRef(0);
  const touchY = useRef<number | null>(null);

  const segments = useLiveQuery(
    async () => ({
      sessionId,
      rows: sessionId && !sharedTranslation
        ? await select<TranscriptSegmentRow>(
            "SELECT * FROM transcript_segments WHERE session_id = ? AND source = (SELECT CASE WHEN EXISTS(SELECT 1 FROM transcript_segments WHERE session_id = ? AND source = 'server') THEN 'server' ELSE 'device' END) ORDER BY t0_ms",
            [sessionId, sessionId],
          )
        : [],
    }),
    ["transcript_segments"],
    [sessionId],
  );
  // A live query may retain its previous data while the next recording loads.
  const ready = sharedTranslation ? sharedTranslation.sessionId === sessionId && sharedTranslation.ready : segments.data?.sessionId === sessionId;
  const rows = useMemo(() => ready ? (sharedTranslation?.rows ?? segments.data?.rows ?? []).filter((row) => row.session_id === sessionId) : [], [segments.data, sessionId, ready, sharedTranslation?.rows]);
  // Standalone panels can still own a queue; the app's PDF screen supplies one
  // shared owner above DockHost, preserving work across live/replay panel rebuilds.
  const localTranslation = useTranscriptTranslation({ enabled: !!translationEnabled && !sharedTranslation, sessionId, ready, rows, target: translationTarget, mode: translationMode });
  const translation = sharedTranslation?.translation ?? localTranslation;
  const localCorrection = useTranscriptCorrection({ enabled: !!correctionEnabled && !sharedTranslation, sessionId, ready, rows });
  const correction = sharedTranslation?.correction ?? localCorrection;
  const source = rows[0]?.source;
  const hasTranslation = rows.some((r) => r.translation);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (q ? rows.filter((r) => r.text.toLowerCase().includes(q) || r.original_text?.toLowerCase().includes(q) || r.translation?.toLowerCase().includes(q)) : rows), [rows, q]);

  const nowMs = mode === "live" ? rec.tMs : pb.positionMs;
  const currentId = mode === "replay" ? rows.find((r) => r.t0_ms <= nowMs && nowMs < r.t1_ms)?.id : rows[rows.length - 1]?.id;

  const scrollToCurrent = useCallback(() => {
    if (!followingRef.current || !listRef.current) return;
    const host = listRef.current;
    const row = currentRowRef.current;
    if (mode !== "live" && !row) return;
    // Keep the speaking sentence visible even before its first finalized segment.
    // Immediate scrolling avoids restarting a smooth animation on every ASR token.
    const target = mode === "live" ? host.scrollHeight - host.clientHeight : row!.offsetTop - host.clientHeight * 0.35;
    host.scrollTo({ top: Math.max(0, target), behavior: "auto" });
    lastScrollTop.current = host.scrollTop;
  }, [mode]);

  const pauseFollow = useCallback(() => {
    followingRef.current = false;
    setFollow(false);
  }, []);
  const resumeFollow = () => {
    followingRef.current = true;
    setFollow(true);
  };

  useLayoutEffect(() => {
    followingRef.current = true;
    setFollow(true);
  }, [sessionId, mode]);

  useLayoutEffect(() => {
    scrollToCurrent();
  }, [scrollToCurrent, currentId, partial, rows, showTranslation, q, follow, sessionId]);

  useLayoutEffect(() => {
    const host = listRef.current;
    const content = contentRef.current;
    if (!host || !content || typeof ResizeObserver === "undefined") return;
    // Covers line wrapping, panel resizing, and translations arriving later.
    const observer = new ResizeObserver(scrollToCurrent);
    observer.observe(host);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToCurrent]);

  const onScroll = () => {
    const host = listRef.current;
    if (!host) return;
    const moved = host.scrollTop - lastScrollTop.current;
    if (moved < -1 || (mode !== "live" && Math.abs(moved) > 1)) pauseFollow();
    lastScrollTop.current = host.scrollTop;
  };

  const chip = mode === "live" ? asrChipFor(asr) : { label: source === "server" ? "服务器转写" : "设备转写", cls: "asr-off" };
  const toggleTranslation = () => {
    if (translationEnabled) translation.stop();
    else setShowTranslation(true);
    void setSetting("transcriptTranslationEnabled", !translationEnabled).catch((error) => toast(S.errors.generic(String(error)), "error"));
  };
  const toggleCorrection = () => {
    if (correctionEnabled) correction.stop();
    void setSetting("transcriptCorrectionEnabled", !correctionEnabled).catch((error) => toast(S.errors.generic(String(error)), "error"));
  };

  let lastPage: number | null = null;

  return (
    <div className="panel transcript-panel">
      <div className="panel-head">
        <div className="input panel-search">
          <Icon name="search" size={18} className="text3" />
          <input placeholder="搜索转写" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="搜索转写" />
        </div>
        <button className={`chip transcript-translation-toggle ${translationEnabled ? "selected" : ""}`} role="switch" aria-label="实时翻译" aria-checked={!!translationEnabled}
          title="开启后从最新完整句开始，后续每完成一句翻译一句" onClick={toggleTranslation}>
          <Icon name="translate" size={16} />翻译<span className="transcript-toggle-state">{translationEnabled ? "开" : "关"}</span>
        </button>
        <button className={`chip transcript-translation-toggle ${correctionEnabled ? "selected" : ""}`} role="switch" aria-label="上下文纠错" aria-checked={!!correctionEnabled}
          title="使用你在设置中填写的 AI 服务，结合前后句修正易混词；原始转写会保留。默认关闭。" onClick={toggleCorrection}>
          <Icon name="spellcheck" size={16} />纠错<span className="transcript-toggle-state">{correctionEnabled ? "开" : "关"}</span>
        </button>
        {hasTranslation && (
          <button className={`chip ${showTranslation ? "selected" : ""}`} onClick={() => setShowTranslation((v) => !v)} style={{ cursor: "pointer" }}>
            显示翻译
          </button>
        )}
      </div>
      {mode === "live" && asr !== "on" && (
        <div className="transcript-status caption" role="status">
          <span>{asr === "error" ? S.errors.asrModel : chip.label}</span>
          {asr === "no_model" && <button className="btn btn-text toolbar-small" onClick={() => navigate("/settings/asr")}>管理转写模型</button>}
        </div>
      )}
      {translationEnabled && (
        <div className={`transcript-status caption ${translation.error ? "transcript-translation-error" : ""}`} role="status" aria-live="polite">
          {translation.error ? (
            <><span>翻译已暂停：{translation.error.message}</span><button className="btn btn-text toolbar-small" onClick={translation.retry}>重试翻译</button><button className="btn btn-text toolbar-small" onClick={() => navigate("/settings")}>设置</button></>
          ) : (
            <span>{translation.progress || `${translationMode === "ai" ? "AI" : "本地"} → ${translationTarget === "en" ? "英文" : "中文"} · ${translation.activeId ? "正在翻译" : "等待完整句"}`}{translation.pendingCount > 0 ? ` · 等待 ${translation.pendingCount} 句` : ""}</span>
          )}
        </div>
      )}
      {correctionEnabled && (
        <div className={`transcript-status caption ${correction.error ? "transcript-translation-error" : ""}`} role="status" aria-live="polite">
          {correction.error ? (
            <><span>纠错已暂停：{correction.error.message}</span><button className="btn btn-text toolbar-small" onClick={correction.retry}>重试纠错</button><button className="btn btn-text toolbar-small" onClick={() => navigate("/settings")}>设置</button></>
          ) : (
            <span>AI 上下文纠错 · {correction.progress || (correction.activeId ? "正在纠错" : correction.waitingForContext ? "等待后文，下一句结束后复核" : "等待完整句")}{correction.pendingCount > 0 ? ` · 等待 ${correction.pendingCount} 句` : ""}</span>
          )}
        </div>
      )}
      <div
        className="panel-body scroll-y transcript-list"
        ref={listRef}
        role="region"
        tabIndex={0}
        aria-label="转写内容"
        onScroll={onScroll}
        onWheel={(e) => { if (e.deltaY < 0 || mode !== "live") pauseFollow(); }}
        onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? null; }}
        onTouchMove={(e) => {
          const y = e.touches[0]?.clientY;
          if (y !== undefined && touchY.current !== null && (y > touchY.current || mode !== "live")) pauseFollow();
          touchY.current = y ?? null;
        }}
        onTouchEnd={() => { touchY.current = null; }}
        onKeyDown={(e) => {
          if (["ArrowUp", "PageUp", "Home"].includes(e.key) || (e.key === " " && e.shiftKey)) pauseFollow();
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.stopPropagation();
        }}
      >
        <div ref={contentRef} className="transcript-content">
        {rows.length === 0 && !partial && (
          <div className="empty">
            <Icon name="subtitles" size={40} />
            {mode === "live" ? (
              <div className="body-small">
                {asr === "no_model" ? "下载转写模型后可以实时转写" : asr === "off" ? "在设置里打开“录音时实时转写”" : asr === "loading" ? "正在加载模型…" : asr === "error" ? S.errors.asrModel : "开始录音后这里显示实时转写"}
              </div>
            ) : (
              <>
                <div className="subtitle" style={{ color: "var(--text)" }}>
                  这节课没有转写
                </div>
                <div className="body-small">{localMode ? "登录后可以上传录音，由服务器做更准确的转写。" : "录音上传后会由服务器转写。"}</div>
              </>
            )}
          </div>
        )}
        {visible.map((r) => {
          const page = r.page_index;
          const divider = page !== null && page !== lastPage;
          lastPage = page;
          return (
            <div key={r.id}>
              {divider && (
                <div className="transcript-divider">
                  <span className="caption text3">第 {page + 1} 页</span>
                </div>
              )}
              <button ref={r.id === currentId ? currentRowRef : undefined} data-id={r.id} className={`transcript-row ${r.id === currentId ? "current" : ""}`} onClick={() => mode === "replay" && pb.seek(r.t0_ms)}>
                <span className="body-small text2 tabular transcript-time">{fmtClock(r.t0_ms)}</span>
                <span className="col grow" style={{ gap: 2 }}>
                  <span className="body">{q ? highlight(r.text, q) : r.text}</span>
                  {r.original_text && r.original_text !== r.text && <span className="caption transcript-corrected">已纠错</span>}
                  {showTranslation && r.translation && <span className="body-small text2">{r.translation}</span>}
                  {translationEnabled && !r.translation && translation.activeId === r.id && <span className="caption text2">翻译中…</span>}
                  {translationEnabled && !r.translation && translation.error?.segmentId === r.id && <span className="caption text2">翻译未完成，可在上方重试</span>}
                  {correctionEnabled && correction.activeId === r.id && <span className="caption text2">结合上下文纠错中…</span>}
                </span>
              </button>
              {r.original_text && r.original_text !== r.text && (
                <OriginalTranscript text={r.original_text} query={q} time={fmtClock(r.t0_ms)} onInspect={pauseFollow} />
              )}
            </div>
          );
        })}
        {partial && <div className="transcript-partial body text2">{partial}</div>}
        </div>
      </div>
      {!follow && (rows.length > 0 || !!partial) && (
        <button className="transcript-back" onClick={() => { setQuery(""); resumeFollow(); }}>
          {mode === "live" ? "回到最新" : "回到当前"}
        </button>
      )}
      <span hidden>{props.api.id}</span>
      <span hidden>{S.panels.transcript}</span>
    </div>
  );
}

/** Kept outside the replay button: inspecting source text must never seek audio. */
function OriginalTranscript({ text, query, time, onInspect }: { text: string; query: string; time: string; onInspect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  useEffect(() => {
    if (query && text.toLowerCase().includes(query)) {
      setExpanded(true);
      onInspect();
    }
  }, [query, text, onInspect]);
  return (
    <div className="transcript-original">
      <button className="transcript-original-toggle caption" aria-expanded={expanded} aria-controls={contentId}
        aria-label={`${expanded ? "收起" : "查看"}原始转写，${time}`} onClick={() => { onInspect(); setExpanded((value) => !value); }}>
        {expanded ? "收起原始转写" : "查看原始转写"}
      </button>
      {expanded && <p className="body-small text2" id={contentId}>{query ? highlight(text, query) : text}</p>}
    </div>
  );
}

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
