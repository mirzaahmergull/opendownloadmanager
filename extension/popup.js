'use strict';
const $ = selector => document.querySelector(selector);
const send = message => chrome.runtime.sendMessage(message).then(result => { if (!result.ok) throw new Error(result.error); return result.value; });
let tab;
function message(text, error = false) { $('#message').textContent = text; $('#message').className = error ? 'error' : ''; }
async function action(button, callback) { button.disabled = true; try { await callback(); } catch (error) { message(error.message, true); } finally { button.disabled = false; } }
async function health() {
  try { const result = await send({ kind: 'health' }); const connected = result.paired; $('#status').textContent = connected ? 'Connected to desktop app' : 'Desktop app found · enter your pairing token'; $('#status').classList.toggle('connected', connected); $('#status-dot').classList.toggle('connected', connected); if (connected) await send({ kind: 'status' }); return connected; }
  catch { $('#status').textContent = 'Desktop app offline · open it to connect'; $('#status').classList.remove('connected'); $('#status-dot').classList.remove('connected'); return false; }
}
async function media() {
  const data = await send({ kind: 'media', tabId: tab?.id }); const list = $('#media-list'); list.replaceChildren();
  if (!data.items.length) { list.textContent = 'No media found yet. Play a video and refresh.'; return; }
  for (const item of data.items.slice().reverse()) {
    const row = document.createElement('div'); row.className = 'media-item';
    const name = document.createElement('span'); let filename = ''; try { filename = decodeURIComponent(new URL(item.url).pathname.split('/').pop()); } catch {}
    name.textContent = filename || item.type || 'Media stream'; name.title = item.url;
    const button = document.createElement('button'); button.textContent = 'Download'; button.onclick = () => action(button, async () => {
      const youtube = /(^|\.)youtube\.com$/.test(new URL(tab.url).hostname);
      const url = youtube ? tab.url : item.url;
      await send({ kind: 'download', input: { url, type: youtube || /mpegurl|dash/i.test(item.type) || /\.(m3u8|mpd)(?:\?|$)/i.test(url) ? 'video' : 'file', format: $('#quality').value, headers: { Referer: tab?.url || '' } } }); message('Download added to the desktop app.');
    }); row.append(name, button); list.append(row);
  }
}
$('#connect').onclick = () => action($('#connect'), async () => {
  const token = $('#token').value.trim(), port = Number($('#port').value);
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Paste the 64-character pairing token from the desktop Integration dialog.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Enter a port between 1024 and 65535.');
  await chrome.storage.local.set({ token, port }); if (await health()) message('Connected. Hover over a video to download it.'); else throw new Error('Connection failed. Check the token and open the desktop app.');
});
for (const id of ['capture', 'panels']) $(`#${id}`).onchange = () => { chrome.storage.local.set({ [id]: $(`#${id}`).checked }); message(id === 'panels' ? 'Saved. Reload open pages to apply panel changes.' : 'Download capture preference saved.'); };
$('#credentials').onchange = async () => {
  try {
    let enabled = $('#credentials').checked;
    if (enabled) enabled = await chrome.permissions.request({ permissions: ['cookies'] });
    $('#credentials').checked = enabled; await chrome.storage.local.set({ credentials: enabled });
    message(enabled ? 'Site cookies will be sent locally for downloads you request.' : 'Cookie sharing disabled.');
  } catch (error) { $('#credentials').checked = false; message(error.message, true); }
};
$('#download').onclick = () => action($('#download'), async () => { const url = $('#url').value.trim() || tab?.url; if (!/^https?:\/\//i.test(url || '')) throw new Error('Enter a HTTP or HTTPS URL.'); const video = /youtube\.com\/|youtu\.be\/|\.(m3u8|mpd)(?:\?|$)/i.test(url) || !/\.[a-z0-9]{2,5}(?:\?|$)/i.test(new URL(url).pathname); await send({ kind: 'download', input: { url, type: video ? 'video' : 'file', format: $('#quality').value, headers: { Referer: tab?.url || '' } } }); message('Download added to the desktop app.'); });
$('#formats').onclick = () => action($('#formats'), async () => { const info = await send({ kind: 'video-info', url: $('#url').value.trim() || tab?.url }); const result = $('#format-results'); result.hidden = false; result.replaceChildren(); const title = document.createElement('b'); title.textContent = info.title; result.append(title, document.createElement('br')); for (const f of info.formats.slice().reverse()) { const line = document.createElement('div'); line.textContent = `${f.height ? f.height + 'p' : 'Audio'} · ${f.ext} · ${f.audio ? 'with audio' : 'video only'} · ${f.id}`; result.append(line); } message('Formats inspected. Choose a quality above to download.'); });
$('#refresh').onclick = () => action($('#refresh'), async () => { await health(); await media(); });
(async () => { const s = await chrome.storage.local.get(['token', 'port', 'capture', 'panels', 'credentials']); $('#token').value = s.token || ''; $('#port').value = s.port || 17843; $('#capture').checked = !!s.capture; $('#panels').checked = s.panels !== false; $('#credentials').checked = !!s.credentials; [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); $('#url').placeholder = tab?.url?.startsWith('http') ? 'Current page: ' + tab.url : 'Paste a file or video URL'; await health(); await media(); })().catch(error => message(error.message, true));

let sessionRequest=new URLSearchParams(location.search).get('session');
async function sessionStatus(){const value=await send({kind:'session-state'});$('#session-status').textContent=value.session.available?'Shared '+new Date(value.session.sharedAt).toLocaleString():'No session shared.';}
$('#share-youtube').onclick=()=>{const permission=chrome.permissions.request({permissions:['cookies']});action($('#share-youtube'),async()=>{if(!await permission)throw Error('Cookie permission was not granted.');await send({kind:'share-youtube',requestId:sessionRequest||undefined});sessionRequest=null;await chrome.storage.local.set({youtubeRefresh:$('#refresh-youtube').checked});await sessionStatus();message('YouTube session shared with the desktop app.');});};
$('#refresh-youtube').onchange=()=>chrome.storage.local.set({youtubeRefresh:$('#refresh-youtube').checked});
$('#forget-youtube').onclick=()=>action($('#forget-youtube'),async()=>{await send({kind:'forget-youtube'});$('#refresh-youtube').checked=false;await sessionStatus();message('Session forgotten.');});
chrome.storage.local.get(['youtubeRefresh']).then(s=>{$('#refresh-youtube').checked=!!s.youtubeRefresh;return sessionStatus();}).catch(()=>{});
if(sessionRequest){$('#youtube-session').scrollIntoView();$('#share-youtube').focus();}
