import { AnnotationFactory } from "annotpdf";
import { readFile } from "@tauri-apps/plugin-fs";
import type { AnnotationRow, DeckPageRow, DeckRow } from "../data/db/schema";
import { parseQuads, parseStrokes } from "../features/session/controllers/annotations";

/**
 * Write MarkPDF annotations into a copy of the PDF as standard annotation
 * objects (Highlight / Ink / FreeText) using annotpdf (docs/SPEC.md 6.5.5 导出).
 *
 * Page space (top-left origin, y down) -> PDF user space (bottom-left origin):
 * y' = height - y. Pages with an intrinsic /Rotate are exported unrotated
 * (documented limitation for v1).
 */
export interface ExportResult {
  bytes: Uint8Array;
  written: number;
  failed: number;
}

/**
 * annotpdf writes each UTF-16 code unit as one byte, so non-Latin text must be
 * pre-encoded as a UTF-16BE PDF text string (BOM FE FF + big-endian bytes).
 */
export function pdfTextString(s: string): string {
  if (/^[\x00-\x7f]*$/.test(s)) return s;
  let out = "\xfe\xff";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += String.fromCharCode(code >> 8) + String.fromCharCode(code & 0xff);
  }
  return out;
}

/** annotpdf `raw_parameters` entries are dictionary text as char codes. */
function ascii(s: string): number[] {
  return Array.from(s, (ch) => ch.charCodeAt(0));
}

function rgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return { r: 245, g: 197, b: 66 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export async function exportAnnotatedPdf(deck: DeckRow, pages: DeckPageRow[], rows: AnnotationRow[]): Promise<ExportResult> {
  if (!deck.local_pdf_path) throw new Error("课件文件不存在");
  const bytes = await readFile(deck.local_pdf_path);
  return annotatePdfBytes(bytes, pages, rows);
}

/** PDF bytes in, annotated PDF bytes out (pure; exported for tests). */
export function annotatePdfBytes(bytes: Uint8Array, pages: Pick<DeckPageRow, "page_index" | "height_pt">[], rows: AnnotationRow[]): ExportResult {
  const factory = new AnnotationFactory(bytes);
  const heights = new Map(pages.map((p) => [p.page_index, p.height_pt]));
  let written = 0;
  let failed = 0;

  for (const r of rows) {
    const H = heights.get(r.page_index);
    if (H === undefined) continue;
    const flipY = (y: number) => H - y;
    try {
      if (r.kind === "highlight") {
        const quads = parseQuads(r);
        if (!quads.length) continue;
        const quadPoints = quads.flatMap((q) => [q[0], flipY(q[1]), q[2], flipY(q[3]), q[4], flipY(q[5]), q[6], flipY(q[7])]);
        factory.createHighlightAnnotation({
          page: r.page_index,
          rect: [r.x, flipY(r.y), r.x + r.w, flipY(r.y + r.h)],
          contents: pdfTextString(r.markdown ?? ""),
          author: "MarkPDF",
          color: rgb(r.color),
          quadPoints,
          opacity: 0.45,
        });
      } else if (r.kind === "ink") {
        const strokes = parseStrokes(r);
        if (!strokes.length) continue;
        factory.createInkAnnotation({
          page: r.page_index,
          rect: [r.x, flipY(r.y), r.x + r.w, flipY(r.y + r.h)],
          contents: "",
          author: "MarkPDF",
          color: rgb(r.color),
          inkList: strokes.map((s) => s.flatMap(([x, y]) => [x, flipY(y)])),
          border: { border_width: r.stroke_width ?? 2 },
        });
      } else if (r.kind === "text_box") {
        const contents = (r.markdown ?? "").trim();
        if (!contents) continue;
        // No appearance stream is written (viewers lay the text out themselves, which keeps
        // CJK working), so the frame comes from the dictionary: /C fills the box (omitted =
        // transparent) and /BS /W 0 removes the default 1 pt border.
        factory.createFreeTextAnnotation({
          page: r.page_index,
          rect: [r.x, flipY(r.y), r.x + r.w, flipY(r.y + r.h)],
          contents: pdfTextString(contents),
          author: "MarkPDF",
          ...(r.fill_color ? { color: rgb(r.fill_color) } : {}),
          textColor: rgb(r.color),
          fontSize: r.font_size ?? 20,
          raw_parameters: [ascii(`/BS << /W ${r.border_color ? 1 : 0} >>`)],
        });
      }
      written += 1;
    } catch (e) {
      console.warn("annotation export failed", r.id, e);
      failed += 1;
    }
  }
  return { bytes: factory.write(), written, failed };
}
