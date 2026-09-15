import type { PDFDocumentProxy } from "pdfjs-dist";
import { exists, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { thumbPath } from "../data/files/file_store";
import { acquireDocument, releaseDocument } from "./documents";

/** Thumbnails: 320 px wide PNGs on disk (docs/SPEC.md 4.6), object URLs in a 200-entry LRU. */

const THUMB_WIDTH = 320;
const LRU_MAX = 200;

const mem = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function key(deckId: string, pageIndex: number): string {
  return `${deckId}:${pageIndex}`;
}

function remember(k: string, url: string): string {
  if (mem.has(k)) mem.delete(k);
  mem.set(k, url);
  if (mem.size > LRU_MAX) {
    const oldest = mem.keys().next().value as string;
    const old = mem.get(oldest);
    mem.delete(oldest);
    if (old) URL.revokeObjectURL(old);
  }
  return url;
}

/** Tiny semaphore so a 100-page rail does not start 100 renders at once. */
let active = 0;
const waiters: (() => void)[] = [];
const MAX_ACTIVE = 2;
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) await new Promise<void>((r) => waiters.push(r));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

async function renderPng(doc: PDFDocumentProxy, pageIndex: number): Promise<Blob> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("toBlob failed");
  return blob;
}

/**
 * Get an object URL for a page thumbnail. `getDoc` is only called on a cache
 * miss, so callers that already hold a document pass `() => Promise.resolve(doc)`.
 */
export async function getThumbnailUrl(
  deckId: string,
  pageIndex: number,
  getDoc: () => Promise<PDFDocumentProxy>,
): Promise<string> {
  const k = key(deckId, pageIndex);
  const hit = mem.get(k);
  if (hit) return remember(k, hit);
  const pending = inflight.get(k);
  if (pending) return pending;

  const task = (async () => {
    const path = await thumbPath(deckId, pageIndex);
    if (await exists(path)) {
      const bytes = await readFile(path);
      return remember(k, URL.createObjectURL(new Blob([bytes], { type: "image/png" })));
    }
    const blob = await withSlot(async () => renderPng(await getDoc(), pageIndex));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    writeFile(path, bytes).catch(() => undefined);
    return remember(k, URL.createObjectURL(blob));
  })();
  inflight.set(k, task);
  try {
    return await task;
  } finally {
    inflight.delete(k);
  }
}

/** Thumbnail for a deck without an open document (list rows, deck cards). */
export async function thumbnailForDeck(deckId: string, pageIndex: number): Promise<string> {
  let acquired = false;
  try {
    return await getThumbnailUrl(deckId, pageIndex, async () => {
      acquired = true;
      return acquireDocument(deckId);
    });
  } finally {
    if (acquired) releaseDocument(deckId);
  }
}

/** Drop cached object URLs (all, or one deck's) so deleted or replaced pages are never shown again. */
export function forgetThumbnails(deckId?: string): void {
  for (const [k, url] of [...mem]) {
    if (deckId && !k.startsWith(`${deckId}:`)) continue;
    mem.delete(k);
    URL.revokeObjectURL(url);
  }
}
