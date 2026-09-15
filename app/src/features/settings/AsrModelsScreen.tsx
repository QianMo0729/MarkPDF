import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ASR_MODELS, DEFAULT_MODEL_HOST, MODEL_HOST_MIRROR } from "../../core/asrModels";
import { S } from "../../core/strings";
import { Icon } from "../../core/ui/Icon";
import { toast } from "../../core/ui/Toast";
import { useLiveQuery } from "../../data/db/live";
import { listAsrModels } from "../../data/db/repos/asrModels";
import { useModelManager } from "./modelManager";
import "./settings.css";

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`;
}

/** Download / delete on-device transcription models (docs/SPEC.md 6.4.5 / 7.6). */
export function AsrModelsScreen() {
  const navigate = useNavigate();
  const mm = useModelManager();
  const dbRows = useLiveQuery(() => listAsrModels(), ["asr_models"]);
  const [starting, setStarting] = useState<string | null>(null);

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

  return (
    <div style={{ padding: 32, maxWidth: 760 }}>
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button className="icon-btn" aria-label={S.session.back} onClick={() => navigate("/settings")}>
          <Icon name="arrow_back" size={24} />
        </button>
        <h1 className="display" style={{ margin: 0 }}>
          转写模型
        </h1>
      </div>
      <div className="caption" style={{ marginBottom: 16 }}>
        模型在本机运行，录音时实时转写，不上传音频。下载源：
        <span className="segmented" style={{ marginLeft: 8, verticalAlign: "middle" }}>
          <button className={mm.host === DEFAULT_MODEL_HOST ? "selected" : ""} onClick={() => void mm.setHost(DEFAULT_MODEL_HOST)}>
            Hugging Face
          </button>
          <button className={mm.host === MODEL_HOST_MIRROR ? "selected" : ""} onClick={() => void mm.setHost(MODEL_HOST_MIRROR)}>
            国内镜像
          </button>
        </span>
      </div>
      {ASR_MODELS.map((def) => {
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
                {fmtSize(def.sizeBytes)}
                {"  "}
                {status === "ready" ? "已就绪（已校验）" : status === "downloading" ? (verifying ? "校验中…" : `下载中 ${Math.round(progress * 100)}%`) : status === "error" ? "不可用" : "未下载"}
              </span>
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
            </div>
            {status === "ready" ? (
              <button className="btn btn-outlined" onClick={() => void mm.remove(def.id)}>
                删除
              </button>
            ) : status === "downloading" && !verifying ? (
              <button className="btn btn-outlined" onClick={() => void mm.cancel(def.id)}>
                {S.common.cancel}
              </button>
            ) : (
              <div className="row" style={{ gap: 8 }}>
                {status === "error" && (
                  <button className="btn btn-text" onClick={() => void mm.remove(def.id)}>
                    删除
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
    </div>
  );
}
