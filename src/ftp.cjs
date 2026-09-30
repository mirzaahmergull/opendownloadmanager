const { Client } = require('basic-ftp');
const { Writable } = require('node:stream');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function runFTP(engine, job, controller) {
  if (engine.settings.proxyURL) throw new Error('FTP transfers currently require a direct connection. Disable the proxy for this transfer.');
  const url = new URL(job.url), remotePath = decodeURIComponent(url.pathname);
  if (/[\r\n]/.test(remotePath)) throw new Error('Invalid FTP path.');
  let user = 'anonymous', password = 'guest';
  const auth = Object.entries(job.headers).find(([key]) => /^authorization$/i.test(key))?.[1];
  if (auth?.startsWith('Basic ')) { const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); const separator = decoded.indexOf(':'); user = decoded.slice(0, separator); password = decoded.slice(separator + 1); }
  if (/[\r\n]/.test(user + password)) throw new Error('Invalid FTP credentials.');
  const client = new Client(30000), signal = controller.signal;
  const abort = () => client.close(); signal.addEventListener('abort', abort, { once: true });
  let timer;
  try {
    signal.throwIfAborted();
    await client.access({ host: url.hostname, port: Number(url.port) || (url.protocol === 'ftps:' ? 990 : 21), user, password, secure: url.protocol === 'ftps:' ? url.port === '21' ? true : 'implicit' : false });
    const size = await client.size(remotePath); const modified = await client.lastMod(remotePath).then(d => d.toISOString()).catch(() => '');
    const features = await client.features(); job.resumable = features.has('REST');
    const part = path.join(engine.jobTemp(job.id), 'ftp.part');
    const reset = job.resetParts || job.size !== size || (job.modified && job.modified !== modified) || !modified || !job.resumable;
    if (reset) { await fsp.rm(part, { force: true }); job.resetParts = false; }
    let offset = await fsp.stat(part).then(s => s.size).catch(() => 0);
    if (offset > size) { await fsp.rm(part, { force: true }); offset = 0; }
    job.size = size; job.modified = modified; job.downloaded = offset; job.segments = [{ index: 0, start: 0, end: size - 1, done: offset }];
    if (!job.userFilename) engine.applyFilename(job, remotePath.split('/').pop() || 'download');
    await fsp.mkdir(job.directory, { recursive: true });
    job.status = 'downloading'; engine.changed(); const started = Date.now();
    timer = setInterval(() => engine.progress(job, offset, started), 500);
    if (offset < size || !fs.existsSync(part)) {
      const handle = await fsp.open(part, 'a');
      const destination = new Writable({ write(chunk, _encoding, callback) {
        (async () => {
          signal.throwIfAborted(); if (job.downloaded + chunk.length > size) throw new Error('FTP server sent more bytes than expected.');
          await engine.throttle(chunk.length, signal); let written = 0;
          while (written < chunk.length) { const result = await handle.write(chunk, written, chunk.length - written); if (!result.bytesWritten) throw new Error('Disk write failed.'); written += result.bytesWritten; }
          job.downloaded += chunk.length; job.segments[0].done = job.downloaded;
        })().then(() => callback(), callback);
      } });
      try { await client.downloadTo(destination, remotePath, offset); }
      finally { destination.destroy(); await handle.close(); }
    }
    signal.throwIfAborted();
    if (job.downloaded !== size || (await fsp.stat(part)).size !== size) throw new Error('FTP connection ended before the file was complete.');
    job.status = 'assembling'; engine.changed();
    const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(part)) { signal.throwIfAborted(); hash.update(chunk); }
    const checksum = hash.digest('hex');
    if (job.expectedChecksum && checksum !== job.expectedChecksum) throw Error('SHA-256 verification failed. The downloaded file does not match the expected checksum.');
    await require('./publication.cjs').publishFile(engine,job,part,signal);
    job.checksum = checksum; job.status = 'complete'; job.speed = 0; job.eta = 0; job.error = ''; job.completedAt = new Date().toISOString();
    await require('./publication.cjs').cleanupTemp(engine,job); engine.emit('complete', engine.publicJob(job));
  } finally { clearInterval(timer); signal.removeEventListener('abort', abort); client.close(); }
}
module.exports = { runFTP };
