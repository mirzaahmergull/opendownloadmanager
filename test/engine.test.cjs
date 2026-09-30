const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Engine, safeName, filenameFrom, categoryFor } = require('../src/engine.cjs');
const { createBridge, grabLinks } = require('../src/bridge.cjs');
const { request } = require('../src/net.cjs');

const data = Buffer.alloc(3 * 1024 * 1024 + 719);
for (let i = 0; i < data.length; i++) data[i] = (i * 31 + Math.floor(i / 255)) % 256;
const hash = crypto.createHash('sha256').update(data).digest('hex');
let server, base, root, requests = [], flaky = 0, version = 'v1';
before(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'odm-tests-'));
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, range: req.headers.range, auth: req.headers.authorization, cookie: req.headers.cookie });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/404') { res.writeHead(404); return res.end('Not found'); }
    if (url.pathname === '/flaky' && flaky++ === 0) { res.writeHead(503); return res.end('Retry later'); }
    if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/file' }); return res.end(); }
    if (url.pathname === '/cross-origin') { res.writeHead(302, { Location: base.replace('127.0.0.1', 'localhost') + '/file' }); return res.end(); }
    if (url.pathname === '/links') return res.end('<a href="/test.zip">zip</a><a href="/test.zip">duplicate</a><video src="/clip.mp4"></video><a href="javascript:alert(1)">bad</a>');
    if (url.pathname === '/empty') { res.writeHead(416, { 'Content-Range': 'bytes */0' }); return res.end(); }
    const ranges = !['/plain', '/unknown', '/truncate'].includes(url.pathname);
    const match = ranges && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = match ? +match[1] : 0; const end = match && match[2] ? +match[2] : data.length - 1;
    if (start >= data.length) { res.writeHead(416); return res.end(); }
    let payload = data.subarray(start, end + 1);
    if (url.pathname === '/changing' && version === 'v2') payload = Buffer.from(payload).fill(42);
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''test%20payload.zip" };
    if (url.pathname !== '/no-validator') headers.ETag = '"' + version + '"';
    if (url.pathname === '/weak-validator') headers.ETag = 'W/"weak"';
    if (url.pathname !== '/unknown') headers['Content-Length'] = payload.length;
    if (match) headers['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
    const badRange = url.pathname === '/bad-range' && req.headers.range !== 'bytes=0-0';
    res.writeHead(badRange ? 200 : match ? 206 : 200, headers);
    if (url.pathname === '/truncate') { res.write(payload.subarray(0, 100)); return setTimeout(() => res.destroy(), 10); }
    let position = 0;
    const slow = ['/slow', '/changing', '/no-validator', '/weak-validator'].includes(url.pathname) || (url.pathname === '/uneven' && start === 0);
    const timer = setInterval(() => {
      const next = payload.subarray(position, position + (slow ? 8192 : 65536));
      position += next.length; res.write(next);
      if (position >= payload.length) { clearInterval(timer); res.end(); }
    }, slow ? 6 : 1);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve)); base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fsp.rm(root, { recursive: true, force: true }); });
async function engine(label, values = {}) { const e = new Engine({ dataDir: path.join(root, label, 'state'), downloadDir: path.join(root, label, 'downloads'), ...values }); e.updateSettings({ retries: 0, categorize: false }); return e; }
async function until(fn, timeout = 12000) { const start = Date.now(); while (!fn()) { if (Date.now() - start > timeout) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 25)); } }
async function completed(e, id, timeout) { await until(() => ['complete', 'error'].includes(e.get(id).status), timeout); const j = e.get(id); assert.equal(j.status, 'complete', j.error); return j; }

test('filename sanitization and categories', () => {
  assert.equal(safeName('../bad\\file:?.exe'), '.._bad_file__.exe');
  assert.equal(safeName('CON.txt'), 'download_CON.txt');
  assert.equal(filenameFrom(base + '/a', "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"), 'résumé.pdf');
  assert.equal(categoryFor('setup.MSI'), 'Programs');
});
test('parallel range transfers produce exact bytes and SHA-256', async () => {
  const e = await engine('parallel'); try {
    requests = []; const j = e.add({ url: base + '/file' }); const result = await completed(e, j.id);
    assert.equal(result.segments.length, 8); assert.equal(result.checksum, hash); assert.deepEqual(await fsp.readFile(result.output), data);
    assert.equal(result.filename, 'test payload.zip'); assert.ok(requests.filter(r => r.range && r.range !== 'bytes=0-0').length >= 8);
    assert.equal(e.snapshot().jobs[0].headers, undefined);
  } finally { await e.close(); }
});
test('pause, resume and application restart recover exact partial offsets', async () => {
  let e = await engine('resume'); const j = e.add({ url: base + '/slow' });
  await until(() => e.get(j.id).downloaded > 60000); await e.pause(j.id);
  const before = e.get(j.id).downloaded; assert.ok(before < data.length); await e.close();
  e = await engine('resume'); try {
    assert.equal(e.get(j.id).status, 'paused'); requests = []; e.resume(j.id); const result = await completed(e, j.id);
    assert.equal(result.checksum, hash); assert.ok(requests.some(r => r.range && +r.range.split(/[=-]/)[1] > 0));
  } finally { await e.close(); }
});
test('server without range support uses one connection and safely restarts', async () => {
  const e = await engine('plain'); try { const j = e.add({ url: base + '/plain' }); const result = await completed(e, j.id); assert.equal(result.resumable, false); assert.equal(result.segments.length, 1); assert.equal(result.checksum, hash); } finally { await e.close(); }
});
test('unknown content length streams to completion', async () => {
  const e = await engine('unknown'); try { const j = e.add({ url: base + '/unknown' }); const result = await completed(e, j.id); assert.equal(result.size, data.length); assert.equal(result.checksum, hash); } finally { await e.close(); }
});
test('empty files complete', async () => {
  const e = await engine('empty'); try { const j = e.add({ url: base + '/empty' }); const result = await completed(e, j.id); assert.equal(result.size, 0); assert.equal((await fsp.stat(result.output)).size, 0); } finally { await e.close(); }
});
test('invalid byte ranges fail without creating a completed output', async () => {
  const e = await engine('bad-range'); try { const j = e.add({ url: base + '/bad-range' }); await until(() => e.get(j.id).status === 'error'); assert.match(e.get(j.id).error, /invalid byte range/); assert.equal(e.get(j.id).output, ''); } finally { await e.close(); }
});
test('truncated response cannot become a completed file', async () => {
  const e = await engine('truncated'); try { const j = e.add({ url: base + '/truncate' }); await until(() => e.get(j.id).status === 'error'); assert.equal(e.get(j.id).output, ''); } finally { await e.close(); }
});
test('remote validator change resets partial files safely', async () => {
  const e = await engine('validator'); try { version = 'v1'; const j = e.add({ url: base + '/changing' }); await until(() => e.get(j.id).downloaded > 60000); await e.pause(j.id); version = 'v2'; e.resume(j.id); const result = await completed(e, j.id); assert.deepEqual(await fsp.readFile(result.output), Buffer.alloc(data.length, 42)); } finally { version = 'v1'; await e.close(); }
});
test('missing validators restart instead of trusting stale partial data', async () => {
  const e = await engine('missing-validator'); try { const j = e.add({ url: base + '/no-validator' }); await until(() => e.get(j.id).downloaded > 60000); await e.pause(j.id); requests = []; e.resume(j.id); const result = await completed(e, j.id); assert.equal(result.checksum, hash); assert.match(requests.find(r => r.range && r.range !== 'bytes=0-0').range, /^bytes=0-/); } finally { await e.close(); }
});
test('finished connections split a slower unfinished segment and preserve byte coverage', async () => {
  const e = await engine('dynamic'); try {
    e.updateSettings({ connections: 2 }); const j = e.add({ url: base + '/uneven' }); const result = await completed(e, j.id);
    assert.ok(result.segments.length > 2); assert.equal(result.checksum, hash);
    const segments = result.segments.slice().sort((a, b) => a.start - b.start);
    assert.equal(segments[0].start, 0); assert.equal(segments.at(-1).end, data.length - 1);
    for (let i = 1; i < segments.length; i++) assert.equal(segments[i].start, segments[i - 1].end + 1);
  } finally { await e.close(); }
});
test('duplicate filenames never overwrite existing files', async () => {
  const e = await engine('duplicate'); try { const a = e.add({ url: base + '/file' }); const b = e.add({ url: base + '/file' }); const [first, second] = await Promise.all([completed(e, a.id), completed(e, b.id)]); assert.notEqual(first.output, second.output); assert.equal(first.checksum, hash); assert.equal(second.checksum, hash); } finally { await e.close(); }
});
test('retry recovers a transient 503', async () => {
  const e = await engine('retry'); try { flaky = 0; e.updateSettings({ retries: 1 }); const j = e.add({ url: base + '/flaky' }); const result = await completed(e, j.id); assert.equal(result.checksum, hash); assert.equal(result.retries, 1); } finally { await e.close(); }
});
test('queue disable, future schedule, and concurrent limits are honored', async () => {
  const e = await engine('queues'); try {
    e.updateSettings({ concurrent: 1 }); e.setQueue({ name: 'Main download queue', enabled: false });
    const a = e.add({ url: base + '/slow' }); const b = e.add({ url: base + '/file' });
    await new Promise(r => setTimeout(r, 100)); assert.equal(e.running.size, 0);
    e.setQueue({ name: 'Main download queue', enabled: true }); assert.equal(e.running.size, 1);
    const c = e.add({ url: base + '/file', scheduledAt: new Date(Date.now() + 60000).toISOString() });
    await completed(e, a.id); await completed(e, b.id); assert.equal(e.get(c.id).status, 'queued');
    e.updateJob(c.id, { scheduledAt: new Date(Date.now() - 1000).toISOString() }); e.tick(); await completed(e, c.id);
  } finally { await e.close(); }
});
test('global speed limiter slows transfer and pause interrupts the wait', async () => {
  const e = await engine('limit'); try { e.updateSettings({ speedLimit: 128 }); const j = e.add({ url: base + '/file' }); await until(() => e.get(j.id).downloaded > 0); await new Promise(r => setTimeout(r, 800)); assert.ok(e.get(j.id).downloaded < 400000); const started = Date.now(); await e.pause(j.id); assert.ok(Date.now() - started < 1000); } finally { await e.close(); }
});
test('remove deletes partial state but keeps completed files', async () => {
  const e = await engine('remove'); try { const j = e.add({ url: base + '/file' }); const result = await completed(e, j.id); await e.remove(j.id); assert.equal(e.jobs.length, 0); assert.ok(fs.existsSync(result.output)); } finally { await e.close(); }
});
test('redirects work and cross-origin redirects strip credentials', async () => {
  const res = await request(base + '/redirect'); res.destroy(); assert.equal(res.statusCode, 200);
  requests = []; const other = await request(base + '/cross-origin', { headers: { Authorization: 'Basic test', Cookie: 'secret=value' } }); other.destroy();
  const redirected = requests.find(r => r.url === '/file'); assert.equal(redirected.auth, undefined); assert.equal(redirected.cookie, undefined);
});
test('bridge rejects missing token and webpage origins, accepts paired extension', async () => {
  const e = await engine('bridge'); const bridge = createBridge(e, { port: 0 }); await bridge.listen(); const address = `http://127.0.0.1:${bridge.server.address().port}`;
  try {
    const denied = await fetch(address + '/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: base + '/file' }) }); assert.equal(denied.status, 401);
    const webpage = await fetch(address + '/status', { headers: { Origin: 'https://evil.example', 'X-ODM-Token': e.token } }); assert.equal(webpage.status, 403);
    const allowed = await fetch(address + '/add', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abcdefgh', 'X-ODM-Token': e.token }, body: JSON.stringify({ url: base + '/file', start: false }) }); assert.equal(allowed.status, 200); assert.equal((await allowed.json()).job.status, 'paused');
    const status = await fetch(address + '/status', { headers: { 'X-ODM-Token': e.token } }); assert.equal((await status.json()).jobs.length, 1);
  } finally { await bridge.close(); await e.close(); }
});
test('grabber resolves relative links and deduplicates', async () => { const links = await grabLinks(base + '/links'); assert.deepEqual(links.map(l => l.url), [base + '/test.zip', base + '/clip.mp4']); });
test('non-HTTP URLs and invalid download paths are rejected', async () => {
  const e = await engine('validation'); try { assert.throws(() => e.add({ url: 'file:///C:/Windows/test' }), /HTTP/); assert.throws(() => e.add({ url: base + '/file', directory: '..' }), /absolute/); assert.throws(() => e.jobTemp('../escape'), /Invalid/); } finally { await e.close(); }
});
test('custom categories override extensions, persist, and preserve existing files on deletion', async () => {
  let e = await engine('categories');
  const folder = path.join(root, 'category-output'); e.setCategory({ name: 'Work PDFs', extensions: 'pdf .txt', directory: folder });
  const j = e.add({ url: base + '/report.pdf', start: false }); assert.equal(j.category, 'Work PDFs');
  e.updateSettings({ categorize: true }); const second = e.add({ url: base + '/report.pdf', start: false }); assert.equal(second.directory, folder);
  await e.close(); e = await engine('categories'); try { assert.ok(e.categories.some(c => c.name === 'Work PDFs')); e.removeCategory('Work PDFs'); assert.equal(e.get(j.id).category, 'Other'); assert.throws(() => e.removeCategory('Other')); } finally { await e.close(); }
});
test('scheduled queue starts stopped files and daily schedule advances', async () => {
  const e = await engine('daily'); try { e.setQueue({ name: 'Daily', enabled: false, concurrent: 1 }); const j = e.add({ url: base + '/file', queue: 'Daily', start: false }); const past = new Date(Date.now() - 1000).toISOString(); e.setQueue({ name: 'Daily', startAt: past, daily: true }); const result = await completed(e, j.id); assert.equal(result.checksum, hash); const q = e.queues.find(q => q.name === 'Daily'); assert.ok(Date.parse(q.startAt) > Date.now()); } finally { await e.close(); }
});
test('queue ordering determines which waiting file starts first', async () => {
  const e = await engine('ordering'); try { e.updateSettings({ concurrent: 1 }); e.setQueue({ name: 'Main download queue', enabled: false }); const a = e.add({ url: base + '/slow', filename: 'first.zip' }); const b = e.add({ url: base + '/file', filename: 'second.zip' }); e.moveJob(b.id, 'up'); e.setQueue({ name: 'Main download queue', enabled: true }); assert.ok(e.running.has(b.id)); assert.ok(!e.running.has(a.id)); await completed(e, b.id); await completed(e, a.id); } finally { await e.close(); }
});
test('refreshing a signed address preserves validated partial offsets', async () => {
  const e = await engine('refresh-address'); try { const j = e.add({ url: base + '/slow?old=1' }); await until(() => e.get(j.id).downloaded > 60000); await e.pause(j.id); const parts = e.get(j.id).downloaded; e.updateJob(j.id, { url: base + '/slow?new=2', preserveParts: true }); assert.equal(e.get(j.id).downloaded, parts); e.resume(j.id); const result = await completed(e, j.id); assert.equal(result.checksum, hash); } finally { await e.close(); }
});
test('changing a URL without preservation discards stale partial bytes', async () => {
  const e = await engine('change-address'); try { version = 'v1'; const j = e.add({ url: base + '/slow' }); await until(() => e.get(j.id).downloaded > 60000); await e.pause(j.id); version = 'v2'; e.updateJob(j.id, { url: base + '/changing' }); e.resume(j.id); const result = await completed(e, j.id); assert.deepEqual(await fsp.readFile(result.output), Buffer.alloc(data.length, 42)); } finally { version = 'v1'; await e.close(); }
});
test('rejected settings do not change the existing download folder', async () => {
  const e = await engine('settings-validation'); try { const folder = e.settings.downloadDir; assert.throws(() => e.updateSettings({ downloadDir: '../invalid' })); assert.equal(e.settings.downloadDir, folder); } finally { await e.close(); }
});
test('HTTP proxy carries all segmented requests and preserves the payload', async () => {
  let hits = 0;
  const proxy = http.createServer((req, res) => { hits++; const outgoing = http.request(req.url, { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); }); outgoing.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(outgoing); });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const e = await engine('http-proxy'); try { e.updateSettings({ proxyURL: `http://127.0.0.1:${proxy.address().port}` }); const j = e.add({ url: base + '/file' }); const result = await completed(e, j.id); assert.equal(result.checksum, hash); assert.ok(hits > 2); } finally { await e.close(); proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
});
test('cookies are scoped to the target host and excluded from public state', async () => {
  const e = await engine('cookies'); try {
    const j = e.add({ url: base + '/file', start: false, cookies: [{ domain: '127.0.0.1', name: 'session', value: 'test-cookie', path: '/' }, { domain: 'unrelated.example', name: 'secret', value: 'do-not-forward' }] });
    assert.equal(e.get(j.id).cookies.length, 1); assert.equal(e.get(j.id).headers.Cookie, 'session=test-cookie'); assert.equal(j.cookies, undefined); assert.equal(j.headers, undefined);
  } finally { await e.close(); }
});
test('credential persistence uses the injected encryptor and decrypts on restart', async () => {
  const key = crypto.randomBytes(32);
  const encryptSecret = text => { const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final()]).toString('base64'); };
  const decryptSecret = blob => { const bytes = Buffer.from(blob, 'base64'), decipher = crypto.createDecipheriv('aes-256-cbc', key, bytes.subarray(0, 16)); return Buffer.concat([decipher.update(bytes.subarray(16)), decipher.final()]).toString('utf8'); };
  let e = await engine('encryption', { encryptSecret, decryptSecret }); const j = e.add({ url: base + '/file', start: false, headers: { Authorization: 'Basic private-test-value' } }); e.updateSettings({ proxyURL: 'http://user:proxy-secret@127.0.0.1:8000' }); const token = e.token; await e.close();
  const serialized = await fsp.readFile(e.statePath, 'utf8'); assert.ok(!serialized.includes('private-test-value')); assert.ok(!serialized.includes('proxy-secret')); assert.ok(!serialized.includes(token));
  e = await engine('encryption', { encryptSecret, decryptSecret }); try { assert.equal(e.get(j.id).headers.Authorization, 'Basic private-test-value'); assert.equal(e.token, token); assert.match(e.settings.proxyURL, /proxy-secret/); } finally { await e.close(); }
});
test('state persistence failure reports a warning without crashing or destroying existing state', async () => {
  const e = await engine('state-write-error'); try {
    const original = await fsp.readFile(e.statePath, 'utf8'); const realPath = e.statePath;
    e.statePath = path.join(e.dataDir, 'missing-parent', 'state.json');
    assert.doesNotThrow(() => e.changed()); assert.match(e.snapshot().loadWarning, /Could not save download history/);
    e.statePath = realPath; assert.equal(await fsp.readFile(realPath, 'utf8'), original); e.changed(); assert.equal(e.persistenceWarning, '');
  } finally { await e.close(); }
});
test('a weak ETag without a modification date cannot authorize saved byte reuse', async () => {
  const e = await engine('weak-etag'); try {
    const j = e.add({ url: base + '/weak-validator' }); await until(() => e.get(j.id).downloaded > 60000); await e.pause(j.id);
    requests = []; e.resume(j.id); const result = await completed(e, j.id); assert.equal(result.checksum, hash);
    assert.match(requests.find(r => r.range && r.range !== 'bytes=0-0').range, /^bytes=0-/);
  } finally { await e.close(); }
});
