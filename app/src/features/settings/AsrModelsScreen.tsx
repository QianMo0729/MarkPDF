import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ASR_MODELS, ASR_TIERS, DEFAULT_MODEL_HOST, DEFAULT_MODEL_ID, MODEL_HOST_MIRROR, tierOf, type AsrLang, type AsrModelDef, type AsrTier } from "../../core/asrModels";
import { S } from "../../core/strings";
import { Icon } from "../../core/ui/Icon";
import { toast } from "../../core/ui/Toast";
import { useLiveQuery } from "../../data/db/live";
import { listAsrModels } from "../../data/db/repos/asrModels";
import { useSettings } from "../../stores/settings";
import { useModelManager } from "./modelManager";
import "./settings.css";

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

function fmtRam(def: AsrModelDef): string {
  const m = def.ram.measuredMiB;
  return m ? `实测占用约 ${m} MB` : `预估占用约 ${def.ram.estimatedMiB} MB`;
}

const LANG_LABEL: Record<AsrLang, string> = { zh: "中文", en: "English" };

/** Download / delete on-device transcription models by size tier (docs/SPEC.md 6.4.5 / 7.6 / 16.2). */
export function AsrModelsScreen() {
  const navigate = useNavigate();
  const mm = useModelManager();
  const dbRows = useLiveQuery(() => listAsrModels(), ["asr_models"]);
  const [starting, setStarting] = useState<string | null>(null);
  const asrModelZh = useSettings((s) => s.settings.asrModelZh);
  const asrModelEn = useSettings((s) => s.settings.asrModelEn);
  const setSetting = useSettings((s) => s.set);
  const chosen: Record<AsrLang, string> = { zh: asrModelZh || DEFAULT_MODEL_ID.zh, en: asrModelEn || DEFAULT_MODEL_ID.en };

  useEffect(() => {
    void mm.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowFor = (id: string) => mm.rows.get(id) ?? dbRows.data?.find((r) => r.id === id);

  const download = async (id: string) => {
    setStarting(id);
    try {
      await mm.download(id);
      if (useModelManager.getState().rows.get(id)?.status === "ready") toast("模型已就绪");
    } catch (e) {
      toast(S.errors.generic(String(e)), "error");
    } finally {
      setStarting(null);
    }
  };

  const choose = (lang: AsrLang, id: string) => void setSetting(lang === "zh" ? "asrModelZh" : "asrModelEn", id === DEFAULT_MODEL_ID[lang] ? "" : id);

  const tiers = ASR_TIERS.map((tier) => ({ tier, models: ASR_MODELS.filter((m) => tierOf(m).id === tier.id) })).filter((t) => t.models.length > 0);

  return (
    <div style={{ padding: 32, maxWidth: 820 }}>
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button className="icon-btn" aria-label={S.session.back} onClick={() => navigate("/settings")}>
          <Icon name="arrow_back" size={24} />
        </button>
        <h1 className="display" style={{ margin: 0 }}>
          转写模型
        </h1>
      </div>
      <div className="caption" style={{ marginBottom: 8 }}>
        模型在本机运行，录音时实时转写，也用于对已有录音重新转写；不上传音频。下载源：
        <span className="segmented" style={{ marginLeft: 8, verticalAlign: "middle" }}>
          <button className={mm.host === DEFAULT_MODEL_HOST ? "selected" : ""} onClick={() => void mm.setHost(DEFAULT_MODEL_HOST)}>
            Hugging Face
          </button>
          <button className={mm.host === MODEL_HOST_MIRROR ? "selected" : ""} onClick={() => void mm.setHost(MODEL_HOST_MIRROR)}>
            国内镜像
          </button>
        </span>
      </div>
      <div className="caption" style={{ marginBottom: 20 }}>
        按下载大小分四档；每档标注建议内存和实际运行占用（含 onnxruntime 本身），实测值来自 Windows x64 本机，其余为按权重大小的估算。语言设置为“自动”时使用中文档位的模型。
      </div>

      {tiers.map(({ tier, models }) => (
        <TierSection key={tier.id} tier={tier}>
          {models.map((def) => {
            const row = rowFor(def.id);
            const status = row?.status ?? "not_downloaded";
            const progress = row?.progress ?? 0;
            const problem = mm.problems.get(def.id);
            const verifying = mm.verifying.has(def.id);
            return (
              <div key={def.id} className="settings-row" style={{ alignItems: "flex-start" }}>
                <div className="col" style={{ gap: 4, flex: "1 1 auto", minWidth: 0 }}>
                  <span className="body">{def.name}</span>
                  <span className="caption">
                    {fmtSize(def.sizeBytes)} · {def.released} · {def.langs.map((l) => LANG_LABEL[l]).join(" + ")}
                    {"  "}
                    {status === "ready" ? "已就绪（已校验）" : status === "downloading" ? (verifying ? "校验中…" : `下载中 ${Math.round(progress * 100)}%`) : status === "error" ? "不可用" : "未下载"}
                  </span>
                  <span className="caption text3">建议内存 ≥ {tier.recommendedRamGb} GB · {fmtRam(def)}</span>
                  <span className="caption text3">{def.notes}</span>
                  {problem && (
                    <span className="caption" style={{ color: "var(--record)" }}>
                      {problem}
                    </span>
                  )}
                  {status === "downloading" && !verifying && (
                    <div style={{ height: 4, background: "var(--surface2)", borderRadius: 2, overflow: "hidden", maxWidth: 360 }}>
                      <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: "var(--accent)", transition: "width 200ms linear" }} />
                    </div>
                  )}
                  {status === "ready" && (
                    <span className="row" style={{ gap: 12, marginTop: 4, flexWrap: "wrap" }}>
                      {def.langs.map((lang) => (
                        <label key={lang} className="caption row" style={{ gap: 4, cursor: "pointer" }}>
                          <input type="radio" name={`asr-default-${lang}`} checked={chosen[lang] === def.id} onChange={() => choose(lang, def.id)} />
                          {LANG_LABEL[lang]}用这个模型
                        </label>
                      ))}
                    </span>
                  )}
                </div>
                {status === "ready" ? (
                  <button className="btn btn-outlined" onClick={() => void mm.remove(def.id)}>
                    卸载
                  </button>
                ) : status === "downloading" && !verifying ? (
                  <button className="btn btn-outlined" onClick={() => void mm.cancel(def.id)}>
                    {S.common.cancel}
                  </button>
                ) : (
                  <div className="row" style={{ gap: 8 }}>
                    {status === "error" && (
                      <button className="btn btn-text" onClick={() => void mm.remove(def.id)}>
                        卸载
                      </button>
                    )}
                    <button className="btn btn-filled" disabled={starting === def.id || verifying} onClick={() => void download(def.id)}>
                      {status === "error" ? "重新下载" : "下载"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </TierSection>
      ))}
    </div>
  );
}

function TierSection({ tier, children }: { tier: AsrTier; children: React.ReactNode }) {
  return (
    <section className="settings-group" aria-label={tier.label} style={{ marginBottom: 20 }}>
      <h2 className="title" style={{ marginBottom: 2 }}>
        {tier.label} · ≤ {tier.maxMiB} MiB
      </h2>
      <p className="caption" style={{ margin: "0 0 8px" }}>
        建议内存 {tier.recommendedRamGb} GB 以上。{tier.note}
      </p>
      {children}
    </section>
  );
}
