const http = require('node:http');
const https = require('node:https');
const { setTimeout: delay } = require('node:timers/promises');
const agents = new Map();
function proxyAgent(proxy, targetProtocol) {
  if (!proxy) return undefined;
  const key = `${targetProtocol}:${proxy}`;
  if (!agents.has(key)) {
    const proxyURL = new URL(proxy); let Agent;
    if (proxyURL.protocol.startsWith('socks')) Agent = require('socks-proxy-agent').SocksProxyAgent;
    else Agent = targetProtocol === 'https:' ? require('https-proxy-agent').HttpsProxyAgent : require('http-proxy-agent').HttpProxyAgent;
    agents.set(key, new Agent(proxy, { keepAlive: true }));
  }
  return agents.get(key);
}

function webURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (url.username || url.password) throw new Error('Use the Authorization field instead of credentials in the URL.');
  return url;
}
function downloadURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:', 'ftp:', 'ftps:'].includes(url.protocol)) throw new Error('Use an HTTP, HTTPS, FTP or FTPS URL.');
  if ((url.username || url.password) && !url.protocol.startsWith('ftp')) throw new Error('Use the Authorization field instead of credentials in the URL.');
  return url;
}

function request(value, { headers = {}, signal, method = 'GET', redirects = 0, proxy = '' } = {}) {
  const url = webURL(value);
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects.'));
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method, signal, agent: proxyAgent(proxy, url.protocol), headers: { 'User-Agent': 'OpenDownloadManager/1.0', 'Accept-Encoding': 'identity', ...headers }
    }, async res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.destroy();
        try {
          const next = new URL(res.headers.location, url);
          const nextHeaders = { ...headers };
          if (next.origin !== url.origin) {
            for (const key of Object.keys(nextHeaders)) if (/^(authorization|cookie)$/i.test(key)) delete nextHeaders[key];
          }
          resolve(await request(next.href, { headers: nextHeaders, signal, method, redirects: redirects + 1, proxy }));
        } catch (error) { reject(error); }
      } else {
        if (res.headers['content-encoding'] && res.headers['content-encoding'].toLowerCase() !== 'identity') { res.destroy(); reject(new Error('Server returned encoded content despite the identity request. Download stopped to prevent incorrect file bytes.')); return; }
        res.finalURL = url.href;
        resolve(res);
      }
    });
    req.setTimeout(30000, () => req.destroy(new Error('Server timed out after 30 seconds.')));
    req.on('error', reject);
    req.end();
  });
}

async function probe(url, headers, signal, proxy = '') {
  const res = await request(url, { headers: { ...headers, Range: 'bytes=0-0' }, signal, proxy });
  const range = /^bytes 0-0\/(\d+)$/.exec(res.headers['content-range'] || '');
  const empty = res.statusCode === 416 && res.headers['content-range'] === 'bytes */0';
  if (res.statusCode >= 400 && !empty) { res.destroy(); throw new Error(`Server returned HTTP ${res.statusCode}.`); }
  const size = empty ? 0 : range ? Number(range[1]) : Number(res.headers['content-length']);
  const meta = {
    size: Number.isSafeInteger(size) && size >= 0 ? size : null,
    resumable: res.statusCode === 206 && !!range,
    etag: res.headers.etag || '', modified: res.headers['last-modified'] || '',
    type: res.headers['content-type'] || '', disposition: res.headers['content-disposition'] || '',
    finalURL: res.finalURL
  };
  res.destroy();
  return meta;
}

async function readText(url, headers = {}, signal, limit = 4 * 1024 * 1024) {
  const res = await request(url, { headers, signal });
  if (res.statusCode >= 400) { res.destroy(); throw new Error(`HTTP ${res.statusCode}`); }
  let size = 0; const chunks = [];
  for await (const chunk of res) {
    size += chunk.length;
    if (size > limit) { res.destroy(); throw new Error('Page exceeds the 4 MB size limit.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = { request, probe, webURL, downloadURL, readText, delay };
