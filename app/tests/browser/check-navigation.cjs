// Run against an existing Vite server. Uses only the synthetic fixture above.
// NODE_PATH can point to the Codex bundled node_modules when Playwright is not
// installed in the project. No persistent browser profile or user DB is opened.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${process.env.NAV_TEST_URL || "http://localhost:1420"}/tests/browser/pdf-navigation.html`);
    await page.waitForFunction(() => window.navigationFixture?.controller.state.pageCount === 3);
    const state = () => page.evaluate(() => window.navigationFixture.snapshot());
    const waitPage = async index => {
      try {
        await page.waitForFunction(i => window.navigationFixture.controller.state.currentPage === i, index, { timeout: 5000 });
      } catch (error) {
        console.error("Expected page", index, "actual", await state(), "browser errors", errors);
        throw error;
      }
    };
    const act = async (method, ...args) => {
      await page.evaluate(({ method, args }) => window.navigationFixture.controller[method](...args), { method, args });
      // Allow pdf.js's rendering/scroll observers to settle between UI actions.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (process.env.NAV_TEST_DEBUG) console.log(method, args, await state());
    };
    const close = (a, b, message) => assert.ok(Math.abs(a - b) <= 2, `${message}: ${a} vs ${b}`);

    await page.locator(".linkAnnotation a").waitFor();
    await page.locator("#container").evaluate(el => { el.scrollTop = 85; });
    const origin = await state();
    await page.locator(".linkAnnotation a").click();
    await waitPage(2);
    const destination = await state();
    assert.equal(destination.canGoBack, true);
    await act("goBack");
    await waitPage(0);
    close((await state()).scrollTop, origin.scrollTop, "Native-link Back restores vertical position");
    assert.equal((await state()).canGoForward, true);
    await act("goForward");
    await waitPage(2);
    close((await state()).scrollTop, destination.scrollTop, "Forward restores destination position");

    await act("goToPage", 1); // Shared entry point for Markdown, search rows, thumbnails, annotations.
    await waitPage(1);
    assert.equal((await state()).canGoForward, false);
    await act("goToDestination", "chapter3"); // Outline/bookmark path.
    await waitPage(2);
    await act("goBack");
    await waitPage(1);

    await act("find", { query: "navigation-needle" }); // Native asynchronous search path.
    await waitPage(2);
    await page.waitForFunction(() => window.navigationFixture.controller.state.findTotal === 1);
    await page.waitForFunction(() => document.querySelector(".textLayer .highlight.selected"));
    await act("goBack");
    await waitPage(1);

    await act("setViewMode", "continuous");
    await act("setScaleValue", "1.4");
    await act("rotate", 90);
    await act("goToPage", 0, { recordHistory: false });
    await waitPage(0);
    await page.locator("#container").evaluate(el => { el.scrollTop += 80; el.scrollLeft = 120; });
    const rotated = await state();
    await act("goToDestination", "chapter3");
    await waitPage(2);
    await act("goBack");
    await waitPage(0);
    const restored = await state();
    assert.equal(restored.rotation, 90);
    assert.equal(restored.scaleValue, "1.4");
    assert.equal(restored.viewMode, "continuous");
    close(restored.scrollTop, rotated.scrollTop, "Continuous rotated PDF restores vertical position");
    close(restored.scrollLeft, rotated.scrollLeft, "Continuous rotated PDF restores horizontal position");
    assert.deepEqual(errors, []);
    console.log("PASS: real pdf.js native links, named outline destinations, page jumps, search, Back/Forward, rotated/zoomed coordinates; no browser page errors.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
