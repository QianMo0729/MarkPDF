import { fixturePdf } from "./pdf-import-fixture";

const result = document.getElementById("result")!;
try {
  // Start without the shim to prove the real packaged PDF.js API reproduces it.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const nativeIterator = Symbol.asyncIterator in ReadableStream.prototype;
  Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator);
  const before = await pdfjs.getDocument({ data: fixturePdf() }).promise;
  let reproduced = false;
  try {
    await (await before.getPage(1)).getTextContent();
  } catch (error) {
    reproduced = error instanceof TypeError;
  } finally {
    await before.loadingTask.destroy();
  }
  if (!reproduced) throw new Error("Expected the missing-iterator failure");
  const { openPdfBytes } = await import("../../src/pdf/pdfjs");
  const doc = await openPdfBytes(fixturePdf());
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map(item => "str" in item ? item.str : "").join("");
    if (text !== "Random Variables and Distributions") throw new Error(`Unexpected text: ${text}`);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = document.getElementById("page") as HTMLCanvasElement;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    const second = await page.getTextContent();
    if (second.items.length !== content.items.length) throw new Error("Repeated extraction failed");
    result.textContent = `PASS\nNative async iterator: ${nativeIterator}\nOriginal error reproduced: ${reproduced}\nText extraction and repeated search extraction: PASS\nPage rendering: PASS\n${text}\n${navigator.userAgent}`;
  } finally {
    await doc.loadingTask.destroy();
  }
} catch (error) {
  result.textContent = `FAIL\n${String(error)}\n${error instanceof Error ? error.stack : ""}`;
}
