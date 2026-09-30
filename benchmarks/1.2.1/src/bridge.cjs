const http = require('node:http');
const crypto = require('node:crypto');
const { webURL, downloadURL, readText } = require('./net.cjs');

async function grabLinks(url) {
  webURL(url);
  const html = await readText(url);
  const links = new Map();
  for (const match of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const target = webURL(new URL(match[1].replace(/&amp;/g, '&'), url).href);
      if (/\.(zip|7z|rar|gz|pdf|exe|msi|iso|mp4|webm|mp3|m4a|epub|docx|xlsx|png|jpg|m3u8|mpd)(?:\?|$)/i.test(target.href)) links.set(target.href, { url: target.href, filename: decodeURIComponent(target.pathname.split('/').pop() || 'file') });
    } catch {}
    if (links.size >= 500) break;
  }
  return [...links.values()];
}
function safeEqual(a, b) { const left = Buffer.from(a || ''), right = Buffer.from(b || ''); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function createBridge(engine, { port = 17843, onAdd = () => {} } = {}) {
  let extensionLastSeen = 0;
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const extensionOrigin = /^(chrome|moz)-extension:\/\/[a-zA-Z0-9-]+$/.test(origin);
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1:\d+$/.test(host)) { res.writeHead(403); return res.end('Invalid host'); }
    if (origin && !extensionOrigin) { res.writeHead(403); return res.end('Only a browser extension can access the bridge.'); }
    if (extensionOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ODM-Token'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    let route;try{route = new URL(req.url, 'http://127.0.0.1').pathname;}catch{res.writeHead(400);return res.end(JSON.stringify({error:'Invalid request URL.'}));}
    if (route === '/health' && req.method === 'GET') return res.end(JSON.stringify({ app: 'Open Download Manager', version: require('../package.json').version, paired: safeEqual(req.headers['x-odm-token'], engine.token) }));
    if (!safeEqual(req.headers['x-odm-token'], engine.token)) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Pair the extension with the desktop app first.' })); }
    extensionLastSeen = Date.now();
    try {
      if (route === '/status' && req.method === 'GET') return res.end(JSON.stringify({ jobs: engine.snapshot().jobs.map(j => ({ id: j.id, filename: j.filename, status: j.status, downloaded: j.downloaded, size: j.size, speed: j.speed })) }));
      if (req.method !== 'POST') { res.writeHead(404); return res.end(JSON.stringify({ error: 'Unknown endpoint.' })); }
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) { res.writeHead(413); res.end(JSON.stringify({ error: 'Request is too large.' })); req.destroy(); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (route === '/add') { const job = engine.add(input); onAdd(job); return res.end(JSON.stringify({ job })); }
      if (route === '/video-info') {
        const controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);
        try{const info=await engine.inspectVideo(input.url,controller.signal);if(!res.destroyed)return res.end(JSON.stringify(info));}
        finally{res.removeListener('close',abort);}return;
      }
      if (route === '/batch') {
        if (!Array.isArray(input.urls) || !input.urls.length || input.urls.length > 200) throw new Error('Choose between 1 and 200 URLs.');
        const urls=[...new Set(input.urls.map(url=>downloadURL(url).href))];
        return res.end(JSON.stringify({ jobs: engine.batch(() => urls.map(url => engine.add({ url, start: input.start !== false, headers: input.headers }))) }));
      }
      res.writeHead(404); res.end(JSON.stringify({ error: 'Unknown endpoint.' }));
    } catch (error) { if(res.destroyed)return;if (!res.headersSent) res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
  });
  return {
    server,
    get extensionLastSeen() { return extensionLastSeen; },
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address()); }); }),
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })
  };
}
module.exports = { createBridge, grabLinks };
