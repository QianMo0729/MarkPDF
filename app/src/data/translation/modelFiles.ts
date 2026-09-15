export interface ModelFile {
  type: string;
  name: string;
  size: number;
  sha256: string;
  url: string;
}

export interface LocalModel {
  id: string;
  from: string;
  to: string;
  version: string;
  label: string;
  files: ModelFile[];
}

export interface LocalTranslationProgress {
  stage: "checking" | "downloading" | "verifying" | "loading" | "translating";
  modelId: string;
  label: string;
  loadedBytes: number;
  totalBytes: number;
  message: string;
}

export interface LocalTranslationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LocalTranslationProgress) => void;
}

export interface ModelStorage {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, data: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  size(key: string): Promise<number | null>;
}

export function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("已取消本地翻译", "AbortError");
}

export function modelFileKey(model: LocalModel, file: ModelFile): string {
  return `${model.id}/${file.name}`;
}

export async function fileMatches(data: Uint8Array, file: ModelFile): Promise<boolean> {
  if (data.byteLength !== file.size) return false;
  // Slice to an owned ArrayBuffer, including for subviews returned by plugins.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data).buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hash === file.sha256;
}

/** Verify before use, and never cache an incomplete or mismatched download. */
export async function ensureModelFiles(
  model: LocalModel,
  storage: ModelStorage,
  download: (file: ModelFile, options: LocalTranslationOptions, progress: (loaded: number) => void) => Promise<Uint8Array>,
  options: LocalTranslationOptions = {},
): Promise<Record<string, ArrayBuffer>> {
  const totalBytes = model.files.reduce((sum, file) => sum + file.size, 0);
  let completed = 0;
  const buffers: Record<string, ArrayBuffer> = {};
  const report = (stage: LocalTranslationProgress["stage"], message: string, loaded = 0) => {
    options.onProgress?.({stage, modelId: model.id, label: model.label,
      loadedBytes: completed + loaded, totalBytes, message});
  };
  for (const file of model.files) {
    abortIfRequested(options.signal);
    report("checking", `正在检查${model.label}模型…`);
    const key = modelFileKey(model, file);
    let bytes = await storage.read(key);
    abortIfRequested(options.signal);
    if (!bytes || !(await fileMatches(bytes, file))) {
      if (bytes) await storage.remove(key);
      abortIfRequested(options.signal);
      bytes = await download(file, options, (loaded) => {
        const percent = Math.round((completed + Math.min(loaded, file.size)) / totalBytes * 100);
        report("downloading", `首次下载${model.label}模型 ${percent}%（文本留在本机）`, Math.min(loaded, file.size));
      });
      abortIfRequested(options.signal);
      report("verifying", `正在校验${model.label}模型…`, bytes.byteLength);
      if (!(await fileMatches(bytes, file))) {
        throw new Error(`${model.label}模型校验失败，请重新下载`);
      }
      abortIfRequested(options.signal);
      await storage.write(key, bytes);
    }
    abortIfRequested(options.signal);
    buffers[file.type] = new Uint8Array(bytes).buffer;
    completed += file.size;
  }
  return buffers;
}
