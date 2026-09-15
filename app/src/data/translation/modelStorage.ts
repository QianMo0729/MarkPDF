import { isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, remove, stat, writeFile } from "@tauri-apps/plugin-fs";
import type { ModelStorage } from "./modelFiles";

let folder: Promise<string> | undefined;
function modelFolder(): Promise<string> {
  return folder ??= appDataDir().then((dir) => join(dir, "translation_models"));
}

const nativeStorage: ModelStorage = {
  async read(key) {
    const path = await join(await modelFolder(), key);
    return await exists(path) ? readFile(path) : null;
  },
  async write(key, data) {
    const root = await modelFolder();
    const parent = await join(root, key.slice(0, key.lastIndexOf("/")));
    await mkdir(parent, {recursive: true});
    // An interrupted write is rejected by size + SHA-256 before any future use.
    await writeFile(await join(root, key), data);
  },
  async remove(key) {
    const path = await join(await modelFolder(), key);
    if (await exists(path)) await remove(path);
  },
  async size(key) {
    const path = await join(await modelFolder(), key);
    return await exists(path) ? (await stat(path)).size : null;
  },
};

// Browser previews use the same persistent/offline behavior without invoking
// native commands. Desktop builds use ordinary files in the app data directory.
let database: Promise<IDBDatabase> | undefined;
function openCache(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("markpdf-local-translation", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}

async function cacheRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", mode);
    const request = run(transaction.objectStore("files"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("本地模型缓存操作中断"));
  });
}

const browserStorage: ModelStorage = {
  async read(key) {
    return (await cacheRequest<Uint8Array | undefined>("readonly", (store) => store.get(key))) ?? null;
  },
  async write(key, data) {
    await cacheRequest("readwrite", (store) => store.put(data, key));
  },
  async remove(key) {
    await cacheRequest("readwrite", (store) => store.delete(key));
  },
  async size(key) {
    return (await this.read(key))?.byteLength ?? null;
  },
};

export function modelStorage(): ModelStorage {
  return isTauri() ? nativeStorage : browserStorage;
}
