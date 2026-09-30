const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

async function freePort() { const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
async function until(fn, timeout = 120000) { const start = Date.now(); while (!await fn()) { if (Date.now() - start > timeout) throw new Error('Portable test timed out.'); await new Promise(r => setTimeout(r, 200)); } }
(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'odm-portable-'));
  const debugPort = await freePort(), bridgePort = await freePort();
  const fixtureVideo=await fs.readFile(require('./generate-fixture.cjs'));
  const payload = Buffer.alloc(1024 * 1024 + 131, 107), expectedHash = crypto.createHash('sha256').update(payload).digest('hex');
  const server = http.createServer((req, res) => { const payload=req.url==='/sample.mp4'?fixtureVideo:Buffer.alloc(1024*1024+131,107);const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''); const start = m ? +m[1] : 0, end = m && m[2] ? +m[2] : payload.length - 1; const part = payload.subarray(start, end + 1); res.writeHead(m ? 206 : 200, { 'Content-Length': part.length, 'Content-Type': req.url==='/sample.mp4'?'video/mp4':'application/zip', ETag: '"portable"', ...(m ? { 'Content-Range': `bytes ${start}-${end}/${payload.length}` } : {}) }); res.end(part); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, ODM_TEST_DATA: dataDir, ODM_TEST_PORT: String(bridgePort) }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = path.resolve(__dirname, `../release/OpenDownloadManager-${require('../package.json').version}-Windows.exe`);
  let child, browser, page, exited = false;
  try {
    child = spawn(executable, [`--remote-debugging-port=${debugPort}`], { env, windowsHide: true, stdio: 'ignore' }); child.on('error', error => console.error(error)); child.on('exit', () => { exited = true; });
    await until(async () => { if (exited) throw new Error('Portable wrapper exited before the app started.'); try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok; } catch { return false; } });
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); [page] = browser.contexts()[0].pages(); await page.waitForFunction(() => !!window.odm);
    const directory = path.join(dataDir, 'downloads');
    const j = await page.evaluate(input => window.odm.invoke('add', input), { url: `http://127.0.0.1:${server.address().port}/portable-check.zip`, directory });
    let result;
    await until(async () => { result = (await page.evaluate(() => window.odm.invoke('snapshot'))).jobs.find(x => x.id === j.id); if (result.status === 'error') throw new Error(result.error); return result.status === 'complete'; });
    assert.deepEqual(await fs.readFile(result.output), payload); assert.equal(result.checksum, expectedHash);
    const integration = await page.evaluate(() => window.odm.invoke('integration')); assert.ok(integration.extensionPath.startsWith(dataDir));
    const pair = await fetch(`http://127.0.0.1:${bridgePort}/status`, { headers: { 'X-ODM-Token': integration.token } }); assert.equal(pair.status, 200);
    const extensionSource = await fs.readFile(path.join(integration.extensionPath, 'content.js'), 'utf8'); assert.ok(extensionSource.includes('Player overlays'));
    const video = await page.evaluate(input => window.odm.invoke('add', { url: input.url, type: 'video', directory:input.directory, format: 'best' }), {directory,url:`http://127.0.0.1:${server.address().port}/sample.mp4`});
    let videoResult;
    await until(async () => { videoResult = (await page.evaluate(() => window.odm.invoke('snapshot'))).jobs.find(x => x.id === video.id); if (videoResult.status === 'error') throw new Error(videoResult.error); return videoResult.status === 'complete' && !!videoResult.checksum; });
    const probe = spawnSync(path.resolve(__dirname, '../tools/ffprobe.exe'), ['-v', 'error', '-show_streams', '-of', 'json', videoResult.output], { windowsHide: true, encoding: 'utf8' }); assert.equal(probe.status, 0, probe.stderr); const streams = JSON.parse(probe.stdout).streams; assert.ok(streams.some(s => s.codec_type === 'video')); assert.ok(streams.some(s => s.codec_type === 'audio'));
    let liveOutcome='not requested';
    if(process.env.ODM_TEST_YOUTUBE==='1'){
      const live=await page.evaluate(directory=>window.odm.invoke('add',{url:'https://www.youtube.com/watch?v=jNQXAC9IVRw',type:'video',directory}),directory);
      await until(async()=>{const snapshot=await page.evaluate(()=>window.odm.invoke('snapshot')),job=snapshot.jobs.find(j=>j.id===live.id);if(job.status==='complete'){liveOutcome='completed';return true;}if(job.status==='error'){if(!/not a bot|sign in to confirm|HTTP Error 403/i.test(job.error))throw Error(job.error);assert.equal(snapshot.videoControl.gate.blocked,true);assert.equal(snapshot.videoControl.gate.strikes,1);liveOutcome='blocked by YouTube sign-in/bot challenge; shared gate held for review';return true;}return false;});
    }
    await page.locator('#rows tr').first().click(); await page.screenshot({ path: path.resolve(__dirname, '../test-results/11-portable-app.png'), animations: 'disabled' });
    await page.evaluate(() => window.odm.invoke('exit')).catch(() => {}); await until(() => exited, 30000);
    await fs.access(path.join(integration.extensionPath, 'manifest.json'));
    console.log('PASS: final portable EXE extracts, launches, downloads exact file bytes, computes checksum, pairs with bridge, downloads local video with audio, exits cleanly, and leaves the extension in persistent data. Live YouTube: '+liveOutcome+'.');
  } finally {
    if (page && !exited) await page.evaluate(() => window.odm.invoke('exit')).catch(() => {});
    await browser?.close().catch(() => {});
    if (child && !exited) { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); await new Promise(r => killer.on('exit', r)); }
    server.closeAllConnections(); await new Promise(r => server.close(r)); await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
