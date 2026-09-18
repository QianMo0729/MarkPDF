import { create } from "zustand";
import { ASR_MODELS, DEFAULT_MODEL_HOST, expectedFiles, modelFileUrl, modelsForLang, type AsrLang, type AsrModelDef } from "../../core/asrModels";
import { getAsrModel, listAsrModels, setAsrModelStatus, upsertAsrModel } from "../../data/db/repos/asrModels";
import type { AsrModelRow } from "../../data/db/schema";
import { asrModelDir } from "../../data/files/file_store";
import { modelsActive, modelsCancel, modelsCheck, modelsDelete, modelsDownload, modelsVerify, onModelProgress } from "../../platform/models";
import { getState, setState } from "../../data/db/repos/syncState";

const HOST_KEY = "asr_model_host";

interface ModelManagerStore {
  rows: Map<string, AsrModelRow>;
  /** Per-model problem text ("校验失败…"), shown under the status. */
  problems: Map<string, string>;
  /** Models whose files are being hash-checked in the background. */
  verifying: Set<string>;
  host: string;
  loaded: boolean;
  load: () => Promise<void>;
  setHost: (host: string) => Promise<void>;
  download: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /**
   * Directory of a ready model for the language setting, or null: the user's
   * choice when it is downloaded, else the built-in default, else any ready
   * model for that language (docs/SPEC.md 16.2).
   */
  readyDirFor: (lang: "auto" | "zh" | "en", selected?: Partial<Record<AsrLang, string>>) => Promise<string | null>;
}

let listening = false;

/** The DB `sha256` column records which manifest digest a directory was verified against. */
function verifiedMark(def: AsrModelDef): string {
  return def.files.encoder.sha256;
}

/**
 * Model download / status bookkeeping (docs/SPEC.md 7.6).
 *
 * A model is "ready" only when every file has the manifest size (cheap check on
 * each load) and the directory was hash-verified once against the manifest
 * (after download, or in the background for copies downloaded before digests
 * existed). Corrupt or foreign files show as "校验失败" with a re-download
 * button instead of being handed to the engine (release audit B05).
 */
export const useModelManager = create<ModelManagerStore>((set, get) => ({
  rows: new Map(),
  problems: new Map(),
  verifying: new Set(),
  host: DEFAULT_MODEL_HOST,
  loaded: false,

  load: async () => {
    const host = (await getState(HOST_KEY)) ?? DEFAULT_MODEL_HOST;
    const existing = new Map((await listAsrModels()).map((r) => [r.id, r]));
    const active = new Set(await modelsActive().catch(() => [] as string[]));
    const toVerify: AsrModelDef[] = [];
    const problems = new Map(get().problems);
    for (const def of ASR_MODELS) {
      const dir = await asrModelDir(def.id);
      const files = expectedFiles(def);
      const row = existing.get(def.id);
      let status: AsrModelRow["status"];
      let sha256 = row?.sha256 ?? null;
      if (active.has(def.id)) {
        // A download survives leaving and re-entering this screen (audit B06).
        status = "downloading";
      } else if (await modelsCheck(dir, files).catch(() => false)) {
        if (sha256 === verifiedMark(def)) status = "ready";
        else {
          status = "downloading"; // verifying; flips to ready / error below
          toVerify.push(def);
        }
      } else {
        status = row?.status === "error" ? "error" : "not_downloaded";
        sha256 = null;
      }
      const next: AsrModelRow = { id: def.id, name: def.name, dir_path: dir, size_bytes: def.sizeBytes, sha256, status, progress: status === "ready" ? 1 : (row?.status === "downloading" ? row.progress : 0) };
      if (!row || row.status !== status || row.dir_path !== dir || row.sha256 !== sha256) await upsertAsrModel(next);
      existing.set(def.id, next);
      if (status === "ready" || status === "not_downloaded") problems.delete(def.id);
    }
    set({ rows: existing, problems, host, loaded: true, verifying: new Set(toVerify.map((d) => d.id)) });
    if (!listening) {
      listening = true;
      await onModelProgress(async (p) => {
        const row = get().rows.get(p.id);
        if (!row) return;
        const status: AsrModelRow["status"] = p.status === "ready" ? "ready" : p.status === "error" ? "error" : p.status === "cancelled" ? "not_downloaded" : "downloading";
        const def = ASR_MODELS.find((m) => m.id === p.id);
        const sha256 = status === "ready" && def ? verifiedMark(def) : status === "downloading" ? row.sha256 : null;
        const updated = { ...row, status, progress: status === "ready" ? 1 : p.progress, sha256 };
        set((s) => {
          const problems = new Map(s.problems);
          if (p.status === "error") problems.set(p.id, p.message ?? "下载失败");
          else problems.delete(p.id);
          return { rows: new Map(s.rows).set(p.id, updated), problems };
        });
        if (p.status !== "downloading") await upsertAsrModel(updated);
      });
    }
    // Background content check for directories that were never hash-verified.
    for (const def of toVerify) {
      void (async () => {
        const dir = await asrModelDir(def.id);
        const ok = await modelsVerify(dir, expectedFiles(def)).catch(() => false);
        set((s) => ({ verifying: new Set([...s.verifying].filter((x) => x !== def.id)) }));
        const row = get().rows.get(def.id);
        if (!row || row.status !== "downloading" || (await modelsActive().catch(() => [] as string[])).includes(def.id)) return;
        const updated: AsrModelRow = ok ? { ...row, status: "ready", progress: 1, sha256: verifiedMark(def) } : { ...row, status: "error", progress: 0, sha256: null };
        await upsertAsrModel(updated);
        set((s) => {
          const problems = new Map(s.problems);
          if (ok) problems.delete(def.id);
          else problems.set(def.id, "模型文件校验失败，请删除后重新下载");
          return { rows: new Map(s.rows).set(def.id, updated), problems };
        });
      })();
    }
  },

  setHost: async (host) => {
    set({ host });
    await setState(HOST_KEY, host);
  },

  download: async (id) => {
    const def = ASR_MODELS.find((m) => m.id === id);
    if (!def) return;
    if (get().rows.get(id)?.status === "downloading") return;
    const dir = await asrModelDir(id);
    await setAsrModelStatus(id, "downloading", 0);
    set((s) => {
      const problems = new Map(s.problems);
      problems.delete(id);
      return { rows: new Map(s.rows).set(id, { ...(s.rows.get(id) as AsrModelRow), status: "downloading", progress: 0, sha256: null }), problems };
    });
    const host = get().host;
    const files = Object.values(def.files).map((f) => ({ url: modelFileUrl(host, def, f), name: f.name, sha256: f.sha256, size_bytes: f.size_bytes }));
    try {
      await modelsDownload(id, dir, files);
      // The progress listener already recorded "ready" + the verified mark.
    } catch (e) {
      const msg = String(e);
      if (msg.includes("cancelled")) return;
      if (msg.includes("download_in_progress")) return;
      throw e;
    }
  },

  cancel: async (id) => {
    await modelsCancel(id);
  },

  remove: async (id) => {
    const dir = await asrModelDir(id);
    await modelsDelete(dir);
    await setAsrModelStatus(id, "not_downloaded", 0);
    const row = await getAsrModel(id);
    set((s) => {
      const problems = new Map(s.problems);
      problems.delete(id);
      return { rows: row ? new Map(s.rows).set(id, { ...row, sha256: null }) : s.rows, problems };
    });
  },

  readyDirFor: async (lang, selected) => {
    for (const def of modelsForLang(lang, selected)) {
      const row = get().rows.get(def.id) ?? (await getAsrModel(def.id));
      if (row?.status === "ready" && row.dir_path) return row.dir_path;
    }
    return null;
  },
}));
