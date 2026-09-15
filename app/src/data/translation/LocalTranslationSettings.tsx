import { useEffect, useRef, useState } from "react";
import { downloadLocalModels, getLocalModelStatus, removeLocalModels, type LocalModelStatus } from "./localTranslation";

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function LocalTranslationSettings() {
  const [models, setModels] = useState<LocalModelStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void getLocalModelStatus().then((items) => { if (mounted.current) setModels(items); }).catch((e: unknown) => {
      if (mounted.current) setError(e instanceof Error ? e.message : "无法读取本地模型状态");
    });
    return () => { mounted.current = false; abort.current?.abort(); };
  }, []);

  const download = async (modelId?: string) => {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(""); setStatus("正在检查本地模型…"); setProgress(0);
    try {
      await downloadLocalModels({modelId, signal: controller.signal, onProgress: (p) => {
        if (!mounted.current) return;
        setStatus(p.message);
        setProgress(p.totalBytes ? p.loadedBytes / p.totalBytes : null);
      }});
      if (mounted.current) setStatus("模型已下载并通过 SHA-256 校验，可以离线翻译");
    } catch (e) {
      if (mounted.current) {
        if (controller.signal.aborted) setStatus("已取消，完整文件已保留，可继续下载");
        else { setError(e instanceof Error ? e.message : String(e)); setStatus(""); }
      }
    } finally {
      if (mounted.current) {
        setBusy(false); setProgress(null);
        try { setModels(await getLocalModelStatus()); }
        catch (e) { setError(e instanceof Error ? e.message : "无法读取本地模型状态"); }
      }
      if (abort.current === controller) abort.current = null;
    }
  };

  const remove = async (modelId: string) => {
    setBusy(true); setError(""); setStatus("");
    try {
      await removeLocalModels(modelId);
      if (mounted.current) { setModels(await getLocalModelStatus()); setStatus("已移除本地模型"); }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="col" style={{gap: 10}}>
      <p className="caption">使用 Mozilla Firefox 的 Bergamot 引擎。首次翻译会下载对应模型；提前下载后即可断网使用，原文在本机处理。</p>
      {models.map((model) => (
        <div className="settings-row" key={model.id}>
          <div className="col" style={{gap: 2}}>
            <span className="body">{model.label}</span>
            <span className="caption">{model.installed ? "已下载 · 使用前校验" : model.downloadedBytes ? `已下载 ${megabytes(model.downloadedBytes)} / ${megabytes(model.totalBytes)}` : `未下载 · ${megabytes(model.totalBytes)}`}</span>
          </div>
          <div className="row" style={{gap: 8}}>
            <button className="btn btn-outlined" disabled={busy} onClick={() => void download(model.id)}>{model.installed ? "校验模型" : "下载模型"}</button>
            {model.downloadedBytes > 0 && <button className="btn btn-text" disabled={busy} onClick={() => void remove(model.id)}>移除</button>}
          </div>
        </div>
      ))}
      <div className="row" style={{gap: 8}}>
        {!models.every((model) => model.installed) && <button className="btn btn-outlined" disabled={busy} onClick={() => void download()}>下载全部中英模型</button>}
        {busy && abort.current && <button className="btn btn-text" onClick={() => abort.current?.abort()}>取消下载</button>}
      </div>
      {busy && progress !== null && <progress aria-label="本地翻译模型下载进度" value={progress} max={1} style={{width: "100%"}} />}
      {status && <p className="caption" role="status">{status}</p>}
      {error && <p className="caption" role="alert" style={{color: "var(--record)"}}>{error}</p>}
    </div>
  );
}
