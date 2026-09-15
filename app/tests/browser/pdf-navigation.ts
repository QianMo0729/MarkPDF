import "pdfjs-dist/web/pdf_viewer.css";
import { openPdfBytes } from "../../src/pdf/pdfjs";
import { PdfViewerController } from "../../src/pdf/viewerController";

// A synthetic document with a native PDF annotation link and a named destination.
// The fixture never imports the application, SQLite, recording, or user files.
function fixturePdf() {
  const content = (text: string) => `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [(chapter3) [7 0 R /XYZ 0 620 null]] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1000] /Resources << /Font << /F1 9 0 R >> >> /Contents 4 0 R /Annots [10 0 R] >>",
    content("BT /F1 20 Tf 40 940 Td (Page one) Tj 0 -120 Td (Jump to chapter three) Tj ET"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1000] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>",
    content("BT /F1 20 Tf 40 940 Td (Page two) Tj ET"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1000] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>",
    content("BT /F1 20 Tf 40 940 Td (Page three) Tj 0 -520 Td (navigation-needle) Tj ET"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Annot /Subtype /Link /Rect [40 800 300 850] /Border [0 0 1] /Dest [7 0 R /XYZ 0 620 null] >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const container = document.getElementById("container") as HTMLDivElement;
const viewer = document.getElementById("viewer") as HTMLDivElement;
const controller = new PdfViewerController(container, viewer, { viewMode: "single", scaleValue: "1" });
controller.setDocument(await openPdfBytes(fixturePdf()));
Object.assign(window, {
  navigationFixture: {
    controller,
    snapshot: () => ({ ...controller.state, scrollTop: container.scrollTop, scrollLeft: container.scrollLeft }),
  },
});
