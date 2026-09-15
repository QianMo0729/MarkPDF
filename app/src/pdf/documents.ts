import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getDeck } from "../data/db/repos/decks";
import { openPdfFile } from "./pdfjs";

/**
 * Reference-counted cache of open pdf.js documents keyed by deck id. The last
 * release destroys the document after a short grace period so quick
 * navigation (course page → deck → back) does not reparse the file.
 */
interface Entry {
  promise: Promise<PDFDocumentProxy>;
  refs: number;
  timer: number | null;
}

const entries = new Map<string, Entry>();
const GRACE_MS = 30_000;

async function resolvePath(deckId: string): Promise<string> {
  const deck = await getDeck(deckId);
  if (!deck?.local_pdf_path) throw new Error(`deck ${deckId} has no local PDF`);
  return deck.local_pdf_path;
}

export function acquireDocument(deckId: string): Promise<PDFDocumentProxy> {
  let entry = entries.get(deckId);
  if (!entry) {
    entry = {
      promise: resolvePath(deckId).then(openPdfFile),
      refs: 0,
      timer: null,
    };
    entries.set(deckId, entry);
    entry.promise.catch(() => entries.delete(deckId));
  }
  if (entry.timer) {
    window.clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.refs += 1;
  return entry.promise;
}

export function releaseDocument(deckId: string): void {
  const entry = entries.get(deckId);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0 && !entry.timer) {
    entry.timer = window.setTimeout(() => {
      entries.delete(deckId);
      entry.promise.then((doc) => doc.loadingTask.destroy()).catch(() => undefined);
    }, GRACE_MS);
  }
}

/** Drop a cached document immediately (e.g. after re-importing the file). */
export function evictDocument(deckId: string): void {
  const entry = entries.get(deckId);
  if (!entry) return;
  entries.delete(deckId);
  if (entry.timer) window.clearTimeout(entry.timer);
  entry.promise.then((doc) => doc.loadingTask.destroy()).catch(() => undefined);
}

export function usePdfDocument(deckId: string | null): { doc: PDFDocumentProxy | null; error: string | null } {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDoc(null);
    setError(null);
    if (!deckId) return;
    let alive = true;
    acquireDocument(deckId)
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
      releaseDocument(deckId);
    };
  }, [deckId]);
  return { doc, error };
}
