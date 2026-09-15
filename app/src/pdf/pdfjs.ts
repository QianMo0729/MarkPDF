import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { readFile } from "@tauri-apps/plugin-fs";

/** Worker, CMaps and standard fonts are copied to public/pdfjs (docs/SPEC.md 14). */
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

export const PDF_ASSET_OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
};

/** Open a local PDF file through the fs plugin (path must be inside the app data dir). */
export async function openPdfFile(path: string): Promise<PDFDocumentProxy> {
  const bytes = await readFile(path);
  return pdfjsLib.getDocument({ data: bytes, ...PDF_ASSET_OPTIONS }).promise;
}

export async function openPdfBytes(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({ data: bytes, ...PDF_ASSET_OPTIONS }).promise;
}

export { pdfjsLib };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
