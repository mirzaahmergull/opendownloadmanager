const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { Engine } = require('../src/engine.cjs');
const { createBridge } = require('../src/bridge.cjs');

async function until(fn, timeout = 15000) { const start = Date.now(); while (!fn()) { if (Date.now() - start > timeout) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 40)); } }
(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'odm-extension-'));
  const video = await fsp.readFile(require('./generate-fixture.cjs'));
  const file = Buffer.alloc(4 * 1024 * 1024, 59);
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><html><head><title>Extension verification</title></head><body style="font:16px Segoe UI;background:#fafafa;padding:40px"><h2>Browser integration verification</h2><p>Hover over the video to send it to the desktop app.</p><video width="640" height="360" src="/sample.mp4" controls muted loop></video><p><a id="file-link" href="/package.zip" download>Download test archive</a></p></body></html>'); }
    const data = req.url === '/sample.mp4' ? video : file; const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const start = m ? +m[1] : 0, end = m && m[2] ? +m[2] : data.length - 1; const payload = data.subarray(start, end + 1);
    res.writeHead(m ? 206 : 200, { 'Content-Length': payload.length, 'Content-Type': req.url === '/sample.mp4' ? 'video/mp4' : 'application/zip', ETag: '"extension-test"', ...(m ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}), ...(req.url === '/package.zip' ? { 'Content-Disposition': 'attachment; filename="package.zip"' } : {}) });
    let offset = 0; const timer = setInterval(() => { const chunk = payload.subarray(offset, offset + 32768); offset += chunk.length; res.write(chunk); if (offset >= payload.length) { clearInterval(timer); res.end(); } }, 3); res.on('close', () => clearInterval(timer));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${server.address().port}`;
  const engine = new Engine({ dataDir: path.join(temp, 'state'), downloadDir: path.join(temp, 'downloads') }); engine.updateSettings({ categorize: false, retries: 0 });
  const bridge = createBridge(engine, { port: 0 }); await bridge.listen();
  const extension = path.resolve(__dirname, '../extension'); let browser;
  try {
    browser = await chromium.launchPersistentContext(path.join(temp, 'browser'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1040, height: 740 } });
    let [worker] = browser.serviceWorkers(); if (!worker) worker = await browser.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(({ token, port }) => chrome.storage.local.set({ token, port, capture: false, panels: true }), { token: engine.token, port: bridge.server.address().port });
    const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await page.locator('video').evaluate(v => v.play()); await page.locator('video').hover();
    await page.locator('#odm-video-download-panel').waitFor({ state: 'visible' });
    const artifacts = path.resolve(__dirname, '../test-results'); await fsp.mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, '07-browser-hover.png') });
    const box = await page.locator('#odm-video-download-panel').boundingBox(); await page.mouse.click(box.x + 90, box.y + 14);
    try { await until(() => engine.jobs.some(j => j.status === 'complete')); }
    catch (error) { await page.screenshot({ path: path.join(artifacts, 'extension-failure.png') }); console.log('Engine:', engine.snapshot()); console.log('Background health:', await worker.evaluate(async () => { try { return await bridge('/health'); } catch (e) { return e.message; } })); throw error; }
    assert.deepEqual(await fsp.readFile(engine.jobs[0].output), video);
    const popup = await browser.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`); await popup.waitForSelector('.status.connected');
    // Opening popup.html as a tab changes the active tab, unlike a real action popup.
    const contentTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url + '/'), url);
    await popup.evaluate(value => { tab = value; }, contentTab);
    await popup.locator('#refresh').click(); await popup.waitForSelector('.media-item'); await popup.screenshot({ path: path.join(artifacts, '08-extension-popup.png') });
    await popup.locator('#capture').check();
    await page.locator('#file-link').click(); await until(() => engine.jobs.some(j => j.filename === 'package.zip' && j.status === 'complete'));
    const archive = engine.jobs.find(j => j.filename === 'package.zip'); assert.deepEqual(await fsp.readFile(archive.output), file);
    const browserDownloads = await worker.evaluate(() => chrome.downloads.search({})); assert.ok(browserDownloads.some(d => d.url.endsWith('/package.zip') && d.state === 'interrupted'));
    await popup.locator('#token').fill('a'.repeat(64)); await popup.locator('#connect').click(); await popup.waitForFunction(() => document.querySelector('#message').classList.contains('error'));
    assert.deepEqual(errors, []);
    console.log('PASS: unpacked extension loads, pairing, real video hover panel, media detection, exact video handoff, automatic download capture, browser cancellation, invalid-token rejection.');
  } finally { await browser?.close(); await bridge.close(); await engine.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); await fsp.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
