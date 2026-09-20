// @vitest-environment node
import { expect, it } from "vitest";
import { openPdfBytes, pdfjsLib } from "../src/pdf/pdfjs";
import { installStreamAsyncIterator } from "../src/pdf/streamCompatibility";

import { fixturePdf } from "./browser/pdf-import-fixture";

it("reproduces the real PDF.js failure without stream iteration and extracts text after the fix", async () => {
  const nativeIterator = Object.getOwnPropertyDescriptor(ReadableStream.prototype, Symbol.asyncIterator)!;
  // Node 24 lacks this API, while the affected Safari 26.3 already provides it.
  // Keep the production PDF.js build in the test and fill this Node-only gap.
  const nativeToHex = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toHex");
  if (!nativeToHex) Object.defineProperty(Uint8Array.prototype, "toHex", {
    configurable: true,
    value(this: Uint8Array) { return Buffer.from(this).toString("hex"); },
  });
  const originalWorker = pdfjsLib.GlobalWorkerOptions.workerSrc;
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/build/pdf.worker.mjs", import.meta.url).href;
  const doc = await openPdfBytes(fixturePdf());
  try {
    const page = await doc.getPage(1);
    Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator);
    await expect(page.getTextContent()).rejects.toBeInstanceOf(TypeError);
    installStreamAsyncIterator();
    const content = await page.getTextContent();
    expect(content.items.map(item => "str" in item ? item.str : "").join("")).toBe("Random Variables and Distributions");
    expect(page.getViewport({ scale: 1 })).toMatchObject({ width: 600, height: 200 });
    // The viewer's search uses this same API again after import.
    expect((await page.getTextContent()).items).toEqual(content.items);
    page.cleanup();
  } finally {
    Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, nativeIterator);
    if (!nativeToHex) Reflect.deleteProperty(Uint8Array.prototype, "toHex");
    pdfjsLib.GlobalWorkerOptions.workerSrc = originalWorker;
    await doc.loadingTask.destroy();
  }
});
