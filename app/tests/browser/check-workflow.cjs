const { chromium } = require('playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
// Real React/pdf.js and actual SQLite migrations with isolated synthetic data.
// Run against Vite. NODE_PATH may supply Playwright and pdf-lib if not installed.
const ROOT = path.resolve(__dirname, '../../..');
const TARGET_URL = process.env.MARKPDF_TEST_URL || 'http://127.0.0.1:1420';
const OUT = path.join(ROOT, 'docs/verification');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const db = new DatabaseSync(':memory:');
  for (const f of fs.readdirSync(path.join(ROOT, 'app/src-tauri/migrations')).sort()) db.exec(fs.readFileSync(path.join(ROOT, 'app/src-tauri/migrations', f), 'utf8'));
  const insert = (table, obj) => db.prepare(`INSERT INTO ${table} (${Object.keys(obj)}) VALUES (${Object.keys(obj).map(() => '?')})`).run(...Object.values(obj));
  const base = { created_at: '2026-09-15T01:00:00Z', updated_at: '2026-09-15T01:00:00Z' };
  for (const [id, name] of [['course-a', '课程 A'], ['course-b', '课程 B']]) insert('courses', { id, name, ...base });
  insert('decks', { id: 'deck-a', title: 'Lecture PDF', course_id: 'course-a', source_type: 'pdf', page_count: 3, file_sha256: 'test-sha', status: 'ready', local_pdf_path: '/qa/deck.pdf', ...base });
  insert('decks', { id: 'deck-b', title: 'Another PDF', course_id: 'course-a', source_type: 'pdf', page_count: 3, file_sha256: 'test-other-sha', status: 'ready', local_pdf_path: '/qa/other.pdf', ...base });
  for (let i = 0; i < 3; i++) insert('deck_pages', { deck_id: 'deck-a', page_index: i, width_pt: 600, height_pt: 800, text: `Lecture page ${i + 1}`, updated_at: base.updated_at });
  for (let i = 1; i <= 2; i++) insert('sessions', { id: `audio-${i}`, course_id: 'course-a', deck_id: 'deck-a', title: `Recording ${i}`, started_at: base.created_at, ended_at: base.created_at, duration_ms: 6000, local_wav_path: `/qa/audio-${i}.wav`, audio_status: 'local', ...base, created_at: `2026-09-15T0${i}:00:00Z` });
  insert('notes', { id: 'note-a', deck_id: 'deck-a', page_index: 0, markdown: 'My saved note', ...base });
  insert('transcript_segments', { id: 'tr-a', session_id: 'audio-1', source: 'device', t0_ms: 0, t1_ms: 3000, text: 'First recording text.', ...base });
  insert('transcript_segments', { id: 'tr-b', session_id: 'audio-2', source: 'device', t0_ms: 0, t1_ms: 3000, text: 'Second recording text.', ...base });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) { const p = pdf.addPage([600, 800]); p.drawText(`Lecture page ${i}`, { x: 50, y: 700, size: 25, font }); }
  const pdfBytes = Array.from(await pdf.save());
  const wav = Buffer.alloc(44 + 16000 * 2 * 6); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const audioUrl = `data:audio/wav;base64,${wav.toString('base64')}`;
  const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: false });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; const calls = [];
  const requests = []; const bodies = new Map(); let nextHttp = 100;
  let delayDeckB = false; let releaseDeckB;
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.exposeFunction('__qaInvoke', async (cmd, args = {}) => {
    calls.push(cmd);
    if (cmd === 'plugin:http|fetch') {
      assert.ok(args.clientConfig.url.startsWith('https://qa.invalid/'));
      const body = JSON.parse(Buffer.from(args.clientConfig.data).toString('utf8'));
      assert.equal('temperature' in body, false); assert.equal('top_p' in body, false);
      requests.push(body);
      const source = body.messages.at(-1).content;
      let correctionInput;
      try { correctionInput = JSON.parse(source); } catch { /* Translation sends plain text. */ }
      const reply = correctionInput?.current_sentence
        ? JSON.stringify({ edits: correctionInput.current_sentence === 'I like it two.' && correctionInput.next_sentence
            ? [{ from: 'two', to: 'too', occurrence: 1 }] : [] })
        : `Translated: ${source}`;
      const rid = ++nextHttp;
      bodies.set(rid, Buffer.from(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] })));
      return rid;
    }
    if (cmd === 'plugin:http|fetch_send') return { rid: args.rid, status: 200, statusText: 'OK', url: 'https://qa.invalid/v1/chat/completions', headers: [['content-type', 'application/json']] };
    if (cmd === 'plugin:http|fetch_read_body') { const body = bodies.get(args.rid); bodies.delete(args.rid); return body ? [...body, 0] : [1]; }
    if (cmd === 'plugin:http|fetch_cancel' || cmd === 'plugin:http|fetch_cancel_body') return null;
    if (cmd === 'plugin:sql|load') return args.db;
    if (cmd === 'plugin:sql|select') {
      if (delayDeckB && /SELECT \* FROM decks WHERE id = \?/.test(args.query) && args.values[0] === 'deck-b') {
        await new Promise(resolve => { releaseDeckB = resolve; });
      }
      return db.prepare(args.query).all(...args.values);
    }
    if (cmd === 'plugin:sql|execute') { const r = db.prepare(args.query).run(...args.values); return [Number(r.changes), Number(r.lastInsertRowid)]; }
    if (cmd === 'plugin:path|resolve_directory') return '/qa';
    if (cmd === 'plugin:path|join' || cmd === 'plugin:path|resolve') return args.paths.join('/');
    if (cmd === 'plugin:fs|exists') return !args.path.endsWith('.png') && !args.path.includes('translation') && !args.path.includes('asr_models');
    if (cmd === 'plugin:fs|read_file') return pdfBytes;
    if (cmd === 'plugin:fs|mkdir' || cmd === 'plugin:fs|write_file') return null;
    if (cmd === 'models_check' || cmd === 'models_verify') return false;
    if (cmd === 'models_active' || cmd === 'take_launch_files') return [];
    if (cmd === 'audio_start' || cmd === 'audio_pause' || cmd === 'audio_resume' || cmd === 'asr_stop') return null;
    if (cmd === 'audio_stop') return { duration_ms: 6000 };
    if (cmd === 'audio_status') return { state: 'idle', t_ms: 0 };
    if (cmd === 'plugin:window|set_theme') return null;
    throw Error(`Unhandled QA command: ${cmd}`);
  });
  await page.addInitScript(({ audioUrl }) => {
    let id = 0;
    const callbacks = new Map(), listeners = new Map();
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      convertFileSrc: () => audioUrl,
      transformCallback: (cb) => { const key = ++id; callbacks.set(key, cb); return key; },
      unregisterCallback: (key) => callbacks.delete(key),
      invoke: async (cmd, args = {}) => {
        if (cmd === 'plugin:event|listen') { const key = ++id; listeners.set(key, { ...args }); return key; }
        if (cmd === 'plugin:event|unlisten') { listeners.delete(args.eventId); return null; }
        return window.__qaInvoke(cmd, args);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__qaEmit = (event, payload) => { for (const [id, l] of listeners) if (l.event === event) callbacks.get(l.handler)?.({ event, id, payload }); };
  }, { audioUrl });
  const results = [];
  try {
    await page.goto(`${TARGET_URL}/#/deck/deck-a`);
    await page.waitForFunction(() => window.__markpdf?.sessionUi.getState().controller?.state.pageCount === 3 && window.__markpdf.sessionUi.getState().controller.state.pagesReady > 0);
    await page.waitForFunction(() => document.querySelector('#deck-recording')?.value === 'audio-2');
    delayDeckB = true;
    await page.evaluate(() => window.__markpdf.navigate('/deck/deck-b?recording=none'));
    await page.waitForURL('**/#/deck/deck-b?recording=none');
    await page.waitForFunction(() => document.querySelector('.session-title')?.textContent === '');
    assert.equal(await page.getByRole('button', { name: '新增录音', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.__markpdf.navigate('/deck/deck-a'));
    delayDeckB = false; releaseDeckB?.();
    await page.waitForFunction(() => document.querySelector('#deck-recording')?.value === 'audio-2');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 2);
    results.push('A new PDF loading asynchronously cannot create a recording on the previously cached PDF');
    await page.getByLabel('此 PDF 的录音').selectOption('audio-1');
    await page.waitForFunction(() => window.__markpdf.playback.getState().sessionId === 'audio-1');
    await page.getByLabel('此 PDF 的录音').selectOption('audio-2');
    await page.waitForFunction(() => window.__markpdf.playback.getState().sessionId === 'audio-2');
    results.push('PDF opens latest recording and switches between both saved recordings');
    await page.getByLabel('此 PDF 的录音').selectOption('');
    await page.waitForFunction(() => window.__markpdf.sessionUi.getState().mode === 'reading');
    assert.equal(await page.evaluate(() => window.__markpdf.playback.getState().sessionId), null);
    results.push('Reading mode unloads playback');
    await page.waitForFunction(() => window.__markpdf.sessionUi.getState().dockApi?.getPanel('outline'));
    await page.evaluate(() => window.__markpdf.sessionUi.getState().dockApi.getPanel('mindmap').api.setActive());
    await page.evaluate(() => window.__markpdf.sessionUi.getState().dockApi.getPanel('outline').api.setActive());
    assert.equal(await page.getByRole('button', { name: '分栏', exact: true }).first().locator('svg').count(), 1);
    assert.equal(await page.getByRole('button', { name: '分栏', exact: true }).first().innerText(), '');
    await page.getByRole('button', { name: '分栏', exact: true }).first().click();
    await page.waitForFunction(() => window.__markpdf.sessionUi.getState().dockApi.groups.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__markpdf.sessionUi.getState().dockApi.groups.map((g) => g.activePanel.id)), ['outline', 'mindmap']);
    assert.equal(await page.locator('.dock-add').count(), 2);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.dock-split')].every((el) => el.nextElementSibling?.classList.contains('dock-add'))), true);
    await page.locator('.dock-add').nth(1).click();
    await page.getByRole('menuitem', { name: '笔记', exact: true }).click();
    await page.getByRole('button', { name: '分栏', exact: true }).nth(1).click();
    await page.waitForFunction(() => window.__markpdf.sessionUi.getState().dockApi.groups.length === 3);
    assert.deepEqual(await page.evaluate(() => window.__markpdf.sessionUi.getState().dockApi.groups.map((g) => g.activePanel.id)), ['outline', 'notes', 'mindmap']);
    await page.screenshot({ path: path.join(OUT, 'custom-three-pane-layout.png'), fullPage: true });
    await page.evaluate(() => window.__markpdf.navigate('/settings'));
    await page.evaluate(() => window.__markpdf.navigate('/deck/deck-a?recording=none'));
    await page.waitForFunction(() => window.__markpdf.sessionUi.getState().dockApi?.groups.length === 3);
    results.push('SVG split icon sits before +; current/previous tabs split top/bottom, every group retains +, three arbitrary groups persist across navigation');
    await page.getByRole('button', { name: '新增录音', exact: true }).click();
    await page.waitForFunction(() => window.__markpdf.recording.getState().status === 'recording');
    const liveId = await page.evaluate(() => window.__markpdf.recording.getState().sessionId);
    assert.notEqual(liveId, 'audio-1'); assert.notEqual(liveId, 'audio-2');
    assert.equal(db.prepare('SELECT deck_id FROM sessions WHERE id = ?').get(liveId).deck_id, 'deck-a');
    await page.evaluate(() => window.__qaEmit('audio://tick', { t_ms: 3000 }));
    assert.equal(await page.getByLabel('此 PDF 的录音').isDisabled(), true);
    await page.evaluate(async () => {
      const s = window.__markpdf.settings.getState();
      await s.set('translationMode', 'ai'); await s.set('llmBaseUrl', 'https://qa.invalid/v1');
      await s.set('llmApiKey', 'synthetic-test-key'); await s.set('llmModel', 'synthetic-test-model');
      window.__markpdf.sessionUi.getState().dockApi.getPanel('transcript').api.setActive();
    });
    await page.getByRole('switch', { name: '实时翻译' }).click();
    await page.evaluate(() => window.__markpdf.recording.setState({ partial: 'The teacher is still speaking. '.repeat(100) }));
    await page.waitForFunction(() => { const el = document.querySelector('.transcript-list'); return el && Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 3; });
    assert.equal(requests.length, 0);
    await page.evaluate(async (id) => { const { insertDeviceSegment } = await import('/src/data/db/repos/transcripts.ts'); await insertDeviceSegment(id, 0, 2000, 'First complete sentence.', 0); window.__markpdf.recording.setState({ partial: '' }); }, liveId);
    await page.getByText('Translated: First complete sentence.', { exact: true }).waitFor();
    await page.evaluate(async (id) => { const { insertDeviceSegment } = await import('/src/data/db/repos/transcripts.ts'); await insertDeviceSegment(id, 2000, 4000, 'Second complete sentence.', 0); }, liveId);
    await page.getByText('Translated: Second complete sentence.', { exact: true }).waitFor();
    assert.equal(requests.length, 2);
    assert.ok(requests[1].messages[0].content.includes('First complete sentence.'));
    await page.screenshot({ path: path.join(OUT, 'live-sentence-translation.png'), fullPage: true });
    await page.getByRole('switch', { name: '实时翻译' }).click();
    await page.evaluate(async (id) => { const { insertDeviceSegment } = await import('/src/data/db/repos/transcripts.ts'); await insertDeviceSegment(id, 4000, 6000, 'Translation is off now.', 0); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }, liveId);
    assert.equal(requests.length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transcript_segments WHERE translation IS NOT NULL').get().n, 2);
    results.push('Live partial text follows bottom without translation; switch translates each final sentence with context and persists it, off stops requests; fixture API receives no sampling parameters');
    await page.getByRole('switch', { name: '上下文纠错' }).click();
    await page.getByRole('switch', { name: '实时翻译' }).click();
    await page.getByText('Translated: Translation is off now.', { exact: true }).waitFor();
    await page.evaluate(async (id) => { const { insertDeviceSegment } = await import('/src/data/db/repos/transcripts.ts'); await insertDeviceSegment(id, 6000, 8000, 'I like it two.', 0); }, liveId);
    await page.getByText('Translated: I like it two.', { exact: true }).waitFor();
    await page.evaluate(async (id) => { const { insertDeviceSegment } = await import('/src/data/db/repos/transcripts.ts'); await insertDeviceSegment(id, 8000, 10000, 'I mean also, not the number.', 0); }, liveId);
    await page.getByText('I like it too.', { exact: true }).waitFor();
    await page.getByText('Translated: I like it too.', { exact: true }).waitFor();
    const corrected = db.prepare("SELECT * FROM transcript_segments WHERE session_id = ? AND text = 'I like it too.'").get(liveId);
    assert.equal(corrected.original_text, 'I like it two.');
    assert.equal(corrected.translation, 'Translated: I like it too.');
    await page.getByRole('button', { name: /查看原始转写/ }).click();
    await page.getByText('I like it two.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /收起原始转写/ }).getAttribute('aria-expanded'), 'true');
    const corrections = requests.flatMap(body => { try { const value = JSON.parse(body.messages.at(-1).content); return value.current_sentence ? [value] : []; } catch { return []; } });
    assert.ok(corrections.some(input => input.current_sentence === 'I like it two.' && input.next_sentence === 'I mean also, not the number.'));
    await page.screenshot({ path: path.join(OUT, 'context-correction.png'), fullPage: true });
    await page.getByRole('switch', { name: '上下文纠错' }).click();
    await page.getByRole('switch', { name: '实时翻译' }).click();
    results.push('Independent correction switch uses following sentence to fix two/too, preserves the ASR original and regenerates persisted translation; AI replies are synthetic fixtures');
    await page.evaluate(() => window.__markpdf.recording.getState().stop());
    await page.waitForFunction(() => window.__markpdf.sessionUi.getState().mode === 'replay');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 3);
    results.push('New recording uses a fresh ID on the PDF, selector locks during recording, stopping enters replay and preserves old recordings');
    await page.screenshot({ path: path.join(OUT, 'pdf-recordings.png'), fullPage: true });
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '移动到其他课程' }).click();
    await page.getByLabel('目标课程').selectOption('course-b');
    await page.getByRole('button', { name: '移动课件', exact: true }).click();
    await page.getByRole('dialog', { name: '移动课件到其他课程' }).waitFor({ state: 'hidden' });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE course_id = 'course-b'").get().n, 3);
    assert.equal(db.prepare('SELECT markdown FROM notes').get().markdown, 'My saved note');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transcript_segments').get().n, 7);
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.waitForURL('**/#/course/course-b');
    results.push('Move dialog moves PDF and every recording, preserves notes/transcripts, Back opens destination course');
    await page.screenshot({ path: path.join(OUT, 'moved-course.png'), fullPage: true });
    await page.evaluate(() => window.__markpdf.navigate('/session/audio-1'));
    await page.waitForURL('**/#/deck/deck-a?recording=audio-1');
    await page.waitForFunction(() => window.__markpdf.playback.getState().sessionId === 'audio-1');
    results.push('Legacy session link redirects to its PDF and selects the correct recording');
    await page.evaluate(() => window.__markpdf.navigate('/settings'));
    await page.getByRole('button', { name: '翻译与 AI' }).click();
    await page.getByRole('heading', { name: 'AI 服务', exact: true }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'translation-settings.png'), fullPage: true });
    await page.setViewportSize({ width: 600, height: 900 });
    await page.evaluate(() => window.__markpdf.navigate('/deck/deck-a'));
    await page.locator('#deck-recording').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: path.join(OUT, 'pdf-recordings-narrow.png'), fullPage: true });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(OUT, 'ui-results.json'), JSON.stringify({ results, errors, scope: 'Real React/pdf.js + in-memory SQLite using actual migrations; native audio/files mocked, no user data accessed.' }, null, 2));
    console.log(JSON.stringify({ results, errors }, null, 2));
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'ui-failure.png'), fullPage: true });
    console.error(JSON.stringify({ error: String(e), errors, recentCalls: calls.slice(-20), results }));
    throw e;
  } finally { await browser.close(); db.close(); }
})();
