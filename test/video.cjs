const { Engine } = require('../src/engine.cjs');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

async function until(fn, timeout = 120000) { const start = Date.now(); while (!fn()) { if (Date.now() - start > timeout) throw new Error('Video timed out.'); await new Promise(r => setTimeout(r, 100)); } }
(async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'odm-video-'));
  const toolsDir = require('../src/platform.cjs').developmentTools(path.resolve(__dirname, '..'));
  const engine = new Engine({ dataDir: path.join(temp, 'state'), downloadDir: path.join(temp, 'downloads'), toolsDir, ffmpegPath: require('../src/platform.cjs').toolPaths(toolsDir).ffmpeg }); engine.updateSettings({ retries: 0 });
  const fixture = await fsp.readFile(require('./generate-fixture.cjs'));
  const server = http.createServer((req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''); const start = m ? +m[1] : 0, end = m && m[2] ? +m[2] : fixture.length - 1; const payload = fixture.subarray(start, end + 1);
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': payload.length, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${fixture.length}` } : {}) }); res.end(payload);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${server.address().port}/sample.mp4`;
  try {
    const info = await engine.inspectVideo(url); assert.ok(info.formats.length > 0);
    const j = engine.add({ url, type: 'video' }); await until(() => ['complete', 'error'].includes(engine.get(j.id).status)); assert.equal(engine.get(j.id).status, 'complete', engine.get(j.id).error); assert.deepEqual(await fsp.readFile(engine.get(j.id).output), fixture);
    console.log('PASS: yt-dlp metadata, format selection, direct video download, output integrity.');
    const audio = engine.add({ url, type: 'video', format: 'bestaudio/best', filename: 'audio-test' });
    await until(() => ['complete', 'error'].includes(engine.get(audio.id).status)); assert.equal(engine.get(audio.id).status, 'complete', engine.get(audio.id).error);
    const audioProbe = spawnSync(require('../src/platform.cjs').toolPaths(toolsDir).ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', engine.get(audio.id).output], { windowsHide: true, encoding: 'utf8' }); assert.equal(audioProbe.status, 0, audioProbe.stderr); const audioStreams = JSON.parse(audioProbe.stdout).streams;
    assert.ok(audioStreams.some(s => s.codec_type === 'audio')); assert.ok(!audioStreams.some(s => s.codec_type === 'video')); assert.ok(engine.get(audio.id).output.endsWith('.mp3'));
    console.log('PASS: audio-only extraction produces a valid MP3 without a video stream.');
    if (process.env.ODM_TEST_YOUTUBE) {
      const youtube = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; const info = await engine.inspectVideo(youtube); assert.ok(info.title); assert.ok(info.formats.some(f => f.video));
      const j = engine.add({ url: youtube, type: 'video', format: 'bestvideo[height<=360]+bestaudio/best[height<=360]' }); await until(() => ['complete', 'error'].includes(engine.get(j.id).status)); assert.equal(engine.get(j.id).status, 'complete', engine.get(j.id).error);
      const probe = spawnSync(require('../src/platform.cjs').toolPaths(toolsDir).ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', engine.get(j.id).output], { windowsHide: true, encoding: 'utf8' }); assert.equal(probe.status, 0, probe.stderr); const streams = JSON.parse(probe.stdout).streams;
      assert.ok(streams.some(s => s.codec_type === 'video')); assert.ok(streams.some(s => s.codec_type === 'audio'));
      console.log(`PASS: live YouTube extraction and merged audio/video (${info.title}, ${engine.get(j.id).size} bytes).`);
    }
  } finally { await engine.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); await fsp.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
