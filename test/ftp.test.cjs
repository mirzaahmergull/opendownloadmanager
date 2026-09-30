const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Engine } = require('../src/engine.cjs');

async function until(fn) { const start = Date.now(); while (!fn()) { if (Date.now() - start > 15000) throw new Error('FTP test timed out.'); await new Promise(r => setTimeout(r, 25)); } }
async function fixture() {
  const payload = Buffer.alloc(2 * 1024 * 1024, 83), commands = [], sockets = new Set(), passiveServers = new Set();
  const server = net.createServer(control => {
    sockets.add(control); control.on('close', () => sockets.delete(control)); control.on('error', () => {});
    let buffer = '', restart = 0, dataSocket, passive;
    const respond = text => control.write(text + '\r\n'); respond('220 Local FTP test');
    control.on('data', bytes => {
      buffer += bytes.toString(); const lines = buffer.split('\r\n'); buffer = lines.pop();
      for (const line of lines) {
        commands.push(line); const [command, ...parts] = line.split(' '), argument = parts.join(' ');
        if (command === 'USER') respond('331 Password required');
        else if (command === 'PASS') respond('230 Logged in');
        else if (command === 'FEAT') respond('211-Features\r\n REST STREAM\r\n SIZE\r\n MDTM\r\n EPSV\r\n211 End');
        else if (['TYPE', 'STRU', 'OPTS'].includes(command)) respond('200 Accepted');
        else if (command === 'PWD') respond('257 "/"');
        else if (command === 'SIZE') respond('213 ' + payload.length);
        else if (command === 'MDTM') respond('213 20260928000000');
        else if (command === 'EPSV') {
          passive = net.createServer(socket => { dataSocket = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); });
          passiveServers.add(passive); passive.listen(0, '127.0.0.1', () => respond(`229 Entering Extended Passive Mode (|||${passive.address().port}|)`));
        }
        else if (command === 'REST') { restart = Number(argument); respond('350 Restart position accepted'); }
        else if (command === 'RETR') {
          respond('150 Opening data connection'); let position = restart;
          const timer = setInterval(() => {
            const chunk = payload.subarray(position, position + 16384); position += chunk.length; dataSocket?.write(chunk);
            if (position >= payload.length) { clearInterval(timer); dataSocket?.end(); respond('226 Transfer complete'); passive?.close(); }
          }, 4);
          dataSocket?.on('close', () => clearInterval(timer));
        }
        else if (command === 'QUIT') { respond('221 Goodbye'); control.end(); }
        else respond('502 Not implemented');
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { payload, commands, url: `ftp://127.0.0.1:${server.address().port}/test.zip`, close: async () => { for (const s of sockets) s.destroy(); for (const p of passiveServers) p.close(); await new Promise(r => server.close(r)); } };
}
test('FTP authentication, pause/resume, REST offset, integrity and checksum', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'odm-ftp-')), ftp = await fixture();
  const e = new Engine({ dataDir: path.join(root, 'state'), downloadDir: path.join(root, 'downloads') }); e.updateSettings({ retries: 0 });
  try {
    const j = e.add({ url: ftp.url.replace('ftp://', 'ftp://test-user:test-password@') }); assert.ok(!j.url.includes('test-password')); assert.equal(j.headers, undefined);
    await until(() => e.get(j.id).downloaded > 65536); await e.pause(j.id); const before = e.get(j.id).downloaded; assert.ok(before < ftp.payload.length);
    e.resume(j.id); await until(() => ['complete', 'error'].includes(e.get(j.id).status)); const result = e.get(j.id);
    assert.equal(result.status, 'complete', result.error); assert.deepEqual(await fsp.readFile(result.output), ftp.payload);
    assert.equal(result.checksum, crypto.createHash('sha256').update(ftp.payload).digest('hex')); assert.ok(ftp.commands.includes('REST ' + before)); assert.ok(ftp.commands.includes('USER test-user'));
  } finally { await e.close(); await ftp.close(); await fsp.rm(root, { recursive: true, force: true }); }
});
test('iteration 11: FTP expected checksum rejects a mismatch before publication',async()=>{
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'odm-ftp-check-')),ftp=await fixture();const e=new Engine({dataDir:path.join(root,'state'),downloadDir:path.join(root,'downloads')});e.updateSettings({retries:0});
 try{const j=e.add({url:ftp.url,expectedChecksum:'0'.repeat(64)});await until(()=>e.get(j.id).status==='error');assert.match(e.get(j.id).error,/SHA-256 verification failed/);assert.equal(e.get(j.id).output,'');assert.equal(e.get(j.id).checksum,'');const good=e.add({url:ftp.url,expectedChecksum:crypto.createHash('sha256').update(ftp.payload).digest('hex')});await until(()=>['complete','error'].includes(e.get(good.id).status));assert.equal(e.get(good.id).status,'complete',e.get(good.id).error);assert.deepEqual(await fsp.readFile(e.get(good.id).output),ftp.payload);}finally{await e.close();await ftp.close();await fsp.rm(root,{recursive:true,force:true});}
});
