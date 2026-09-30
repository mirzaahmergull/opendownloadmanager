const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { Engine } = require('../src/engine.cjs');
const { createBridge } = require('../src/bridge.cjs');

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'odm-youtube-browser-'));
  const toolsDir = require('../src/platform.cjs').developmentTools(path.resolve(__dirname, '..'));
  const engine = new Engine({ dataDir: path.join(root, 'state'), downloadDir: path.join(root, 'downloads'), toolsDir, ffmpegPath: require('../src/platform.cjs').toolPaths(toolsDir).ffmpeg }); engine.updateSettings({ retries: 0 });
  const bridge = createBridge(engine, { port: 0 }); await bridge.listen(); const extension = path.resolve(__dirname, '../extension'); let browser;
  try {
    browser = await chromium.launchPersistentContext(path.join(root, 'browser'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1280, height: 850 } });
    let [worker] = browser.serviceWorkers(); if (!worker) worker = await browser.waitForEvent('serviceworker');
    await worker.evaluate(values => chrome.storage.local.set(values), { token: engine.token, port: bridge.server.address().port, panels: true, capture: false });
    const page = await browser.newPage(); await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const reject = page.getByRole('button', { name: /Reject all/i }); if (await reject.count()) await reject.first().click();
    await page.locator('video').first().waitFor({ state: 'visible', timeout: 45000 });
    await page.locator('video').first().evaluate(video => { video.muted = true; video.play().catch(() => {}); });
    const videoBox = await page.locator('video').first().boundingBox(); await page.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2);
    const panel = page.locator('#odm-video-download-panel'); await panel.waitFor({ state: 'visible' });
    const artifacts = path.resolve(__dirname, '../test-results'); await fsp.mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, '09-live-youtube-hover.png') });
    const box = await panel.boundingBox(); await page.mouse.click(box.x + 80, box.y + 14);
    const started = Date.now(); while (!engine.jobs.some(j => ['complete', 'error'].includes(j.status))) { if (Date.now() - started > 120000) throw new Error('YouTube hover download timed out.'); await new Promise(r => setTimeout(r, 200)); }
    const job = engine.jobs[0]; assert.equal(job.status, 'complete', job.error); assert.equal(job.type, 'video'); assert.ok(job.url.includes('youtube.com/watch'));
    const info = spawnSync(require('../src/platform.cjs').toolPaths(toolsDir).ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', job.output], { windowsHide: true, encoding: 'utf8' }); assert.equal(info.status, 0, info.stderr); const streams = JSON.parse(info.stdout).streams;
    assert.ok(streams.some(s => s.codec_type === 'video')); assert.ok(streams.some(s => s.codec_type === 'audio'));
    console.log(`PASS: live YouTube page, actual hover panel click, desktop handoff, merged video/audio (${job.filename}, ${job.size} bytes).`);
  } finally { await browser?.close(); await bridge.close(); await engine.close(); await fsp.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
