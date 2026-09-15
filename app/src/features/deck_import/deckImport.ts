import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { S } from "../../core/strings";
import { newId, nowIso } from "../../core/utils/ids";
import { findDeckBySha, getDeck, insertDeck, updateDeck, upsertDeckPages } from "../../data/db/repos/decks";
import type { DeckPageRow, DeckRow } from "../../data/db/schema";
import { deckPdfPath, deckSourcePath } from "../../data/files/file_store";
import { evictDocument } from "../../pdf/documents";
import { openPdfFile } from "../../pdf/pdfjs";
import { copyFileIntoApp, fileSha256, fileSize } from "../../platform/files";

export type ImportProgress = (message: string) => void;

/** PPTX conversion needs the server, which this version does not ship (docs/SPEC.md M9). */
export class PptxUnsupportedError extends Error {
  constructor() {
    super(S.importFlow.pdfOnly);
  }
}

export interface ImportResult {
  deck: DeckRow;
  duplicate: boolean;
}

function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, "");
}

function extOf(path: string): string {
  return (path.split(".").pop() ?? "").toLowerCase();
}

/** Show the file picker (PDF only in this version) and import the chosen deck. Returns null if cancelled. */
export async function pickAndImportDeck(courseId: string, onProgress: ImportProgress): Promise<ImportResult | null> {
  const path = await pickPdf();
  if (!path) return null;
  return importDeckFromPath(courseId, path, onProgress);
}

export async function pickPdf(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!picked) return null;
  return typeof picked === "string" ? picked : (picked as { path: string }).path;
}

/**
 * Import flow for a PDF path (docs/SPEC.md 6.4.4). A previous failed or
 * interrupted import of the same file is resumed on its existing row instead of
 * being treated as a duplicate (release audit PM-06).
 */
export async function importDeckFromPath(courseId: string, path: string, onProgress: ImportProgress): Promise<ImportResult> {
  const ext = extOf(path);
  if (ext === "pptx") throw new PptxUnsupportedError();
  if (ext !== "pdf") throw new Error(S.importFlow.pdfOnly);

  onProgress(S.importFlow.copying);
  const sha = await fileSha256(path);
  const existing = await findDeckBySha(courseId, sha);
  if (existing?.status === "ready") return { deck: existing, duplicate: true };
  if (existing) return { deck: await runImport(existing, path, onProgress), duplicate: false };

  const id = newId();
  const ts = nowIso();
  const deck: DeckRow = {
    id,
    course_id: courseId,
    title: baseName(path),
    source_type: "pdf",
    page_count: 0,
    file_sha256: sha,
    remote_key: null,
    status: "importing",
    error_message: null,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    local_pdf_path: await deckPdfPath(id),
    local_source_path: null,
    dirty: 1,
  };
  await insertDeck(deck);
  return { deck: await runImport(deck, path, onProgress), duplicate: false };
}

/** Copy + index onto an existing row; failure leaves the row in `error` with a reason. */
async function runImport(deck: DeckRow, sourcePath: string, onProgress: ImportProgress): Promise<DeckRow> {
  const pdfPath = deck.local_pdf_path ?? (await deckPdfPath(deck.id));
  try {
    await updateDeck(deck.id, { status: "importing", error_message: null, local_pdf_path: pdfPath });
    await copyFileIntoApp(sourcePath, pdfPath);
    const pages = await extractPages(deck.id, pdfPath, onProgress);
    await upsertDeckPages(pages);
    await updateDeck(deck.id, { page_count: pages.length, status: "ready", error_message: null });
    evictDocument(deck.id);
    return (await getDeck(deck.id)) ?? { ...deck, local_pdf_path: pdfPath, page_count: pages.length, status: "ready" };
  } catch (e) {
    await updateDeck(deck.id, { status: "error", error_message: String(e) });
    throw e;
  }
}

/** True when the copied PDF is present and non-empty, i.e. a retry only needs re-indexing. */
export async function hasLocalPdf(deck: DeckRow): Promise<boolean> {
  if (!deck.local_pdf_path) return false;
  if (!(await exists(deck.local_pdf_path).catch(() => false))) return false;
  return (await fileSize(deck.local_pdf_path).catch(() => 0)) > 0;
}

/** Re-read page sizes and text for an already copied deck (used by "retry"). */
export async function reindexDeck(deck: DeckRow, onProgress: ImportProgress): Promise<void> {
  if (!deck.local_pdf_path) throw new Error("no local file");
  try {
    const pages = await extractPages(deck.id, deck.local_pdf_path, onProgress);
    await upsertDeckPages(pages);
    await updateDeck(deck.id, { page_count: pages.length, status: "ready", error_message: null });
  } catch (e) {
    await updateDeck(deck.id, { status: "error", error_message: String(e) });
    throw e;
  }
}

async function extractPages(deckId: string, pdfPath: string, onProgress: ImportProgress): Promise<DeckPageRow[]> {
  const doc = await openPdfFile(pdfPath);
  try {
    const rows: DeckPageRow[] = [];
    const n = doc.numPages;
    for (let i = 1; i <= n; i++) {
      onProgress(S.importFlow.readingPages(i, n));
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (item.str) text += item.str;
        if (item.hasEOL) text += "\n";
      }
      rows.push({
        deck_id: deckId,
        page_index: i - 1,
        width_pt: vp.width,
        height_pt: vp.height,
        text: text.replace(/[ \t]+\n/g, "\n").trim(),
        speaker_notes: null,
        updated_at: nowIso(),
      });
      page.cleanup();
    }
    return rows;
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Source path helper kept for the PPTX flow (M9). */
export { deckSourcePath };
