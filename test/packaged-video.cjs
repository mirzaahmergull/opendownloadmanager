const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

(async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'odm-packaged-video-'));
  const executablePath = process.env.ODM_TEST_EXE || path.resolve(__dirname, '../release/win-unpacked/Open Download Manager.exe');
  const env = { ...process.env, ODM_TEST_DATA: dataDir, ODM_TEST_PORT: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath, args: [], env });
    const page = await app.firstWindow(); await page.waitForFunction(() => !!window.odm);
    const job = await page.evaluate(directory => window.odm.invoke('add', { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', type: 'video', directory, format: 'bestvideo[height<=360]+bestaudio/best[height<=360]' }), path.join(dataDir, 'downloads'));
    const started = Date.now(); let result;
    while (true) {
      result = (await page.evaluate(() => window.odm.invoke('snapshot'))).jobs.find(j => j.id === job.id);
      if (result.status === 'complete' && result.checksum) break;
      if (result.status === 'error') throw new Error(result.error);
      if (Date.now() - started > 120000) throw new Error(JSON.stringify({ status: result.status, error: result.error, retries: result.retries }));
      await new Promise(r => setTimeout(r, 200));
    }
    assert.equal(result.status, 'complete', result.error); assert.ok(result.checksum);
    const probe = spawnSync(path.resolve(__dirname, '../tools/ffprobe.exe'), ['-v', 'error', '-show_streams', '-of', 'json', result.output], { windowsHide: true, encoding: 'utf8' }); assert.equal(probe.status, 0, probe.stderr); const streams = JSON.parse(probe.stdout).streams;
    assert.ok(streams.some(s => s.codec_type === 'video')); assert.ok(streams.some(s => s.codec_type === 'audio'));
    const integration = await page.evaluate(() => window.odm.invoke('integration')); assert.ok(integration.extensionPath.startsWith(dataDir)); await fsp.access(path.join(integration.extensionPath, 'manifest.json'));
    await page.locator('#rows tr').click(); await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.resolve(__dirname, '../test-results/10-packaged-youtube.png') });
    console.log(`PASS: packaged app uses bundled yt-dlp, FFmpeg and Electron's Node runtime to download and merge YouTube; SHA-256 present; extension copied to persistent data (${result.filename}).`);
  } finally { await app?.close(); await fsp.rm(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
