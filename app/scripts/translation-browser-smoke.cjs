/* Isolated Chromium integration check. Run with an independent Vite server.
 * PLAYWRIGHT_MODULE can point at the bundled runtime's Playwright package.
 * Pass --fixtures to replay locally downloaded official model attachments. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const base = process.env.TRANSLATION_TEST_URL || 'http://127.0.0.1:1428';
const models = JSON.parse(fs.readFileSync(path.join(app, 'src/data/translation/models.json')));
const fixtures = process.argv.includes('--fixtures');
const modelDir = path.join(app, '../.cache/translation-research/models');
const modelPaths = new Map(models.flatMap(model => model.files.map(file => [file.url, path.join(modelDir, model.id, file.name)])));
const downloads = [], unexpectedExternal = [], pageErrors = [], results = [];
const assert = (value, message) => {if (!value) throw new Error(message)};

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  const context = await browser.newContext();
  try {
    await context.route(base + '/translation-test', route => route.fulfill({contentType:'text/html', body:'<!doctype html><title>Offline translation verification</title><main>Local translation test</main>'}));
    const download = async route => {
      const request = route.request();
      downloads.push({method:request.method(), url:request.url(), body:request.postData()});
      if (fixtures) {
        assert(modelPaths.has(request.url()), 'Unexpected model URL');
        await route.fulfill({path:modelPaths.get(request.url()),contentType:'application/octet-stream', headers:{'Access-Control-Allow-Origin':'*'}});
      } else await route.continue();
    };
    await context.route('https://firefox-settings-attachments.cdn.mozilla.net/**', download);
    let page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', message => {if (message.type() === 'error') console.error('Browser:', message.text())});
    page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure()?.errorText));
    await page.goto(base + '/translation-test');
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {window.translation = await import('/src/data/translation/localTranslation.ts')});
    await page.evaluate(async () => {await window.translation.downloadLocalModels()});
    const statuses = await page.evaluate(async () => window.translation.getLocalModelStatus());
    assert(statuses.every(model => model.installed), 'Models not persisted');
    assert(downloads.length === 7, `Expected seven files, got ${downloads.length}`);
    assert(downloads.every(request => request.method === 'GET' && request.body === null), 'Unexpected text upload');
    await page.close();
    await context.unroute('https://firefox-settings-attachments.cdn.mozilla.net/**', download);
    await context.route('**/*', async route => {
      if (route.request().url().startsWith(base + '/')) return route.fallback();
      unexpectedExternal.push(route.request().url());
      return route.abort('internetdisconnected');
    });
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.goto(base + '/translation-test');
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {window.translation = await import('/src/data/translation/localTranslation.ts')});
    for (const [text, target] of [
      ['Machine learning is a branch of artificial intelligence.', 'zh'],
      ['机器学习是人工智能的一个分支。', 'en'],
      ['The student is reading a book in the library.', 'zh'],
    ]) {
      const result = await page.evaluate(async ({text,target}) => {
        const start = performance.now();
        const output = await window.translation.translateLocal(text,target);
        return {output,milliseconds:Math.round(performance.now()-start)};
      }, {text,target});
      assert(result.output.trim() && result.output !== text, 'Missing translation');
      results.push({source:text,target,...result});
      console.log(JSON.stringify(results.at(-1)));
    }
    assert(!unexpectedExternal.length, `Offline model path attempted external requests: ${unexpectedExternal}`);
    assert(!pageErrors.length, `Browser errors: ${pageErrors}`);
    const evidence = {testedAt:new Date().toISOString(), environment:'isolated headless Edge / Chromium',
      modelDownloadSource:fixtures?'verified local fixtures':'Mozilla official CDN', downloadRequests:downloads,
      modelStatusAfterDownload:statuses,
      offlineTest:'fresh page and worker; all external requests blocked; persistent IndexedDB cache',
      unexpectedExternalRequests:unexpectedExternal, pageErrors, results};
    fs.writeFileSync(path.join(app, '../docs/translation-browser-smoke.json'), JSON.stringify(evidence,null,2)+'\n');
    console.log('Offline browser verification passed.');
  } finally {await context.close(); await browser.close()}
})().catch(error => {console.error(error);process.exitCode=1});
