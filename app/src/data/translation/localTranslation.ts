import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import registry from "./models.json";
import { abortIfRequested, ensureModelFiles, modelFileKey, type LocalModel,
  type LocalTranslationOptions, type LocalTranslationProgress, type ModelFile } from "./modelFiles";
import { modelStorage } from "./modelStorage";

export type { LocalTranslationOptions, LocalTranslationProgress } from "./modelFiles";
export const LOCAL_MODELS: readonly LocalModel[] = registry;

export interface LocalModelStatus {
  id: string;
  label: string;
  installed: boolean;
  downloadedBytes: number;
  totalBytes: number;
}

/** Files come exclusively from the pinned, public Mozilla manifest. */
async function downloadFile(file: ModelFile, options: LocalTranslationOptions, progress: (loaded: number) => void): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    abortIfRequested(options.signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, {once: true});
    const timeout = setTimeout(abort, 180_000);
    try {
      progress(0);
      const fetcher = isTauri() ? tauriFetch : fetch;
      const response = await fetcher(file.url, {signal: controller.signal, credentials: "omit"});
      if (!response.ok) throw new Error(`下载模型失败 (${response.status})`);
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            abortIfRequested(options.signal);
            const {done, value} = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            if (loaded > file.size) throw new Error("模型下载长度与官方清单不符");
            chunks.push(value);
            progress(loaded);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        loaded = bytes.byteLength;
        chunks.push(bytes);
      }
      abortIfRequested(options.signal);
      const bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      progress(loaded);
      return bytes;
    } catch (error) {
      abortIfRequested(options.signal);
      lastError = error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  throw new Error(`本地模型下载失败，已下载且校验通过的文件会保留，请重试。${lastError instanceof Error ? lastError.message : "请检查网络连接"}`);
}

export async function getLocalModelStatus(): Promise<LocalModelStatus[]> {
  const storage = modelStorage();
  return Promise.all(LOCAL_MODELS.map(async (model) => {
    const sizes = await Promise.all(model.files.map((file) => storage.size(modelFileKey(model, file))));
    return {
      id: model.id, label: model.label,
      installed: sizes.every((size, index) => size === model.files[index].size),
      downloadedBytes: sizes.reduce<number>((sum, size, index) => sum + (size === model.files[index].size ? size : 0), 0),
      totalBytes: model.files.reduce((sum, file) => sum + file.size, 0),
    };
  }));
}

// Serializing cache writes/deletion avoids download, translate and model removal
// racing over the same files. Queued aborted actions never start work.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const operation = queue.catch(() => undefined).then(() => { abortIfRequested(signal); return action(); });
  queue = operation;
  return operation;
}

export function downloadLocalModels(options: LocalTranslationOptions & {modelId?: string} = {}): Promise<void> {
  return serialized(async () => {
    const models = options.modelId ? LOCAL_MODELS.filter((model) => model.id === options.modelId) : LOCAL_MODELS;
    if (!models.length) throw new Error("未知本地翻译模型");
    for (const model of models) await ensureModelFiles(model, modelStorage(), downloadFile, options);
  }, options.signal);
}

export function removeLocalModels(modelId?: string): Promise<void> {
  return serialized(async () => {
    stopWorker();
    for (const model of LOCAL_MODELS.filter((entry) => !modelId || entry.id === modelId)) {
      for (const file of model.files) await modelStorage().remove(modelFileKey(model, file));
    }
  });
}

let worker: Worker | undefined;
let workerReady: Promise<void> | undefined;
let currentModel: string | undefined;
let nextId = 0;
let idleTimeout: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>}>();

function stopWorker(reason = new Error("本地翻译已取消")) {
  worker?.terminate();
  worker = undefined;
  workerReady = undefined;
  currentModel = undefined;
  if (idleTimeout) clearTimeout(idleTimeout);
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(reason); }
  pending.clear();
}

function callWorker(method: string, payload?: unknown, transfers: Transferable[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => stopWorker(new Error("本地翻译超时，请缩短文本后重试")), 120_000);
    pending.set(id, {resolve, reject, timer});
    try { worker!.postMessage({id, method, payload}, transfers); }
    catch (error) { stopWorker(error instanceof Error ? error : new Error(String(error))); }
  });
}

function initializeWorker(): Promise<void> {
  if (workerReady) return workerReady;
  const base = import.meta.env.BASE_URL;
  worker = new Worker(new URL(`${base}translation/bergamot/worker.js`, window.location.href));
  worker.onmessage = ({data}: MessageEvent<{id: number; result?: unknown; error?: string}>) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  };
  worker.onerror = () => stopWorker(new Error("离线翻译引擎加载失败，请确认应用资源完整"));
  worker.onmessageerror = () => stopWorker(new Error("离线翻译模型传输失败，请重试"));
  workerReady = callWorker("initialize").then(() => undefined).catch((error: unknown) => {
    stopWorker();
    throw error;
  });
  return workerReady;
}

/** Local English ↔ Simplified Chinese; first use downloads only model files. */
export function translateLocal(text: string, target: string, options: LocalTranslationOptions = {}): Promise<string> {
  return serialized(async () => {
    const input = text.trim();
    if (!input) return "";
    if (input.length > 20_000) throw new Error("本地翻译每次支持最多 20,000 个字符，请分段翻译");
    const toChinese = /^(zh(?:-Hans|-CN)?|中文|简体中文)$/i.test(target);
    const toEnglish = /^(en(?:-US|-GB)?|English|英文|英语)$/i.test(target);
    if (!toChinese && !toEnglish) throw new Error("本地翻译目前支持英语与简体中文互译");
    // Already in the requested language (numbers and punctuation also pass through).
    if (toEnglish && !/\p{Script=Han}/u.test(input)) return input;
    if (toChinese && !/[A-Za-z]/.test(input)) return input;
    const model = LOCAL_MODELS[toChinese ? 0 : 1];
    if (idleTimeout) clearTimeout(idleTimeout);
    const report = (stage: LocalTranslationProgress["stage"], message: string) => options.onProgress?.({
      stage, modelId: model.id, label: model.label, loadedBytes: 0, totalBytes: 0, message,
    });
    const abort = () => stopWorker(new DOMException("本地翻译已取消", "AbortError"));
    try {
      const files = currentModel === model.id ? undefined : await ensureModelFiles(model, modelStorage(), downloadFile, options);
      abortIfRequested(options.signal);
      options.signal?.addEventListener("abort", abort, {once: true});
      report("loading", "正在加载本地翻译引擎…");
      await initializeWorker();
      abortIfRequested(options.signal);
      if (files) {
        await callWorker("loadModel", {id: model.id, from: model.from, to: model.to, files}, Object.values(files));
        currentModel = model.id;
      }
      abortIfRequested(options.signal);
      report("translating", "正在本机翻译…");
      const result = await callWorker("translate", input);
      abortIfRequested(options.signal);
      if (typeof result !== "string" || !result.trim()) throw new Error("本地翻译没有返回内容，请缩短文本后重试");
      return result.trim();
    } catch (error) {
      // A model/runtime failure must be recoverable on the next attempt.
      stopWorker();
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      idleTimeout = setTimeout(() => stopWorker(), 90_000);
    }
  }, options.signal);
}
