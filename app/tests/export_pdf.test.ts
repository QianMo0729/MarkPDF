import { describe, expect, it } from "vitest";
import type { AnnotationRow } from "../src/data/db/schema";
import { annotatePdfBytes, pdfTextString } from "../src/domain/export_pdf";

describe("pdfTextString", () => {
  it("leaves ASCII alone", () => {
    expect(pdfTextString("hello")).toBe("hello");
  });
  it("encodes non-ASCII as UTF-16BE with BOM, one byte per char", () => {
    const s = pdfTextString("和");
    expect(s.charCodeAt(0)).toBe(0xfe);
    expect(s.charCodeAt(1)).toBe(0xff);
    expect(s.charCodeAt(2)).toBe(0x54);
    expect(s.charCodeAt(3)).toBe(0x8c);
    expect(s.length).toBe(4);
  });
});

/** Smallest PDF annotpdf will parse: one empty Letter page with a classic xref table. */
function minimalPdf(): Uint8Array {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const pages = [{ page_index: 0, height_pt: 792 }];
const textBox = (extra: Partial<AnnotationRow>): AnnotationRow => ({
  id: "a1",
  deck_id: "d",
  page_index: 0,
  kind: "text_box",
  x: 10,
  y: 10,
  w: 100,
  h: 40,
  color: "#E5484D",
  markdown: "hello",
  selected_text: null,
  quads_json: null,
  strokes_json: null,
  stroke_width: null,
  font_size: 12,
  border_color: null,
  fill_color: null,
  z: 0,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  dirty: 0,
  ...extra,
});
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("annotatePdfBytes text boxes", () => {
  it("writes a frameless, transparent FreeText by default", () => {
    const res = annotatePdfBytes(minimalPdf(), pages, [textBox({})]);
    expect(res.written).toBe(1);
    expect(res.failed).toBe(0);
    const out = latin1(res.bytes);
    expect(out).toContain("/FreeText");
    expect(out).toContain("/BS << /W 0 >>");
    expect(out).not.toMatch(/\/C\s*\[/);
  });

  it("writes the fill colour and a 1 pt border when the box has them", () => {
    const out = latin1(annotatePdfBytes(minimalPdf(), pages, [textBox({ fill_color: "#FFFFFF", border_color: "#1B2130" })]).bytes);
    expect(out).toContain("/BS << /W 1 >>");
    expect(out).toMatch(/\/C\s*\[\s*1\s+1\s+1\s*\]/);
  });
});
