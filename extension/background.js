'use strict';
const DEFAULTS = { token: '', port: 17843, capture: false, panels: true, credentials: false, youtubeRefresh:false, youtubeSharedAt:0, notificationMode:'errors' };
const MEDIA_PATTERN = /\.(mp4|webm|m4a|mp3|m3u8|mpd|mov|flac|ogg)(?:[?#]|$)/i;
const FILE_PATTERN = /\.(zip|7z|rar|gz|exe|msi|msix|iso|pdf|epub|docx|xlsx|pptx|mp4|webm|mp3|m4a)(?:[?#]|$)/i;
const isHTTP = url => /^https?:\/\//i.test(url || '');
const isYoutube = url => { try { return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(new URL(url).hostname); } catch { return false; } };
async function config() { return { ...DEFAULTS, ...await chrome.storage.local.get(Object.keys(DEFAULTS)) }; }
async function bridge(route, body, timeout = 15000) {
  const settings = await config();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`http://127.0.0.1:${settings.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-ODM-Token': settings.token },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal
    });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
  } catch (error) {
    if (error instanceof TypeError || error.name === 'AbortError') throw new Error('Desktop app is not reachable. Open it and check your pairing settings.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function notify(message,event='error') {const s=await config();if(s.notificationMode==='none'||event==='complete'&&s.notificationMode!=='all')return; await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Open Download Manager', message }); }
async function addDownload(input) {
  if (!isHTTP(input.url)) throw new Error('This source is a blob or protected stream. Try downloading the page URL as a video instead.');
  const settings = await config();
  if (settings.credentials && await chrome.permissions.contains({ permissions: ['cookies'] })) {
    input.cookies = await chrome.cookies.getAll({ url: input.url });
  }
  const result = await bridge('/add', input);
  await chrome.action.setBadgeText({ text: '✓' }); await chrome.action.setBadgeBackgroundColor({ color: '#398b3e' });
  return result;
}
function installMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'odm-link', title: 'Download with Open Download Manager', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'odm-video', title: 'Download this video with Open Download Manager', contexts: ['video', 'audio', 'page'] });
    chrome.contextMenus.create({ id: 'odm-selected', title: 'Download selected links with Open Download Manager', contexts: ['selection'] });
  });
}
chrome.runtime.onInstalled.addListener(() => { installMenus(); chrome.alarms.create('odm-health', { periodInMinutes: 1 }); });
chrome.runtime.onStartup.addListener(() => { installMenus(); chrome.alarms.create('odm-health', { periodInMinutes: 1 }); });
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'odm-link') await addDownload({ url: info.linkUrl, headers: { Referer: info.pageUrl || tab.url } });
    if (info.menuItemId === 'odm-video') await addDownload({ url: isYoutube(tab.url) ? tab.url : info.srcUrl && isHTTP(info.srcUrl) ? info.srcUrl : tab.url, type: 'video', headers: { Referer: tab.url } });
    if (info.menuItemId === 'odm-selected') {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        const selection = window.getSelection();
        return [...new Set([...document.querySelectorAll('a[href]')].filter(a => selection?.containsNode(a, true)).map(a => a.href).filter(url => /^https?:\/\//.test(url)))].slice(0, 200);
      } });
      const urls = results[0]?.result || []; if (!urls.length) throw new Error('Select text that contains downloadable links first.');
      await bridge('/batch', { urls, headers: { Referer: tab.url } });
    }
    await notify('Download sent to the desktop app.','complete');
  } catch (error) { await notify(error.message); }
});
async function rememberMedia(tabId, item) {
  if (tabId < 0 || !isHTTP(item.url)) return;
  const key = `media:${tabId}`; const stored = await chrome.storage.session.get(key); const items = stored[key] || [];
  if (!items.some(i => i.url === item.url)) { items.push(item); await chrome.storage.session.set({ [key]: items.slice(-40) }); }
}
chrome.webRequest.onHeadersReceived.addListener(details => {
  const type = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
  if (MEDIA_PATTERN.test(details.url) || /^(video|audio)\/|mpegurl|dash\+xml/i.test(type)) rememberMedia(details.tabId, { url: details.url, type, time: Date.now() }).catch(() => {});
}, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders']);
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(`media:${tabId}`));
chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.type === 'main_frame') chrome.storage.session.remove(`media:${details.tabId}`);
}, { urls: ['http://*/*', 'https://*/*'] });
chrome.downloads.onCreated.addListener(async item => {
  const settings = await config(); if (!settings.capture || !settings.token) return;
  const url = item.finalUrl || item.url;
  if (!isHTTP(url)) return;
  try {
    await addDownload({ url, filename: item.filename ? item.filename.split(/[\\/]/).pop() : '', headers: item.referrer ? { Referer: item.referrer } : {} });
    // Tiny browser transfers can finish before the desktop accepts the handoff.
    await chrome.downloads.cancel(item.id).catch(() => {});
  } catch (error) { await notify(`Browser download kept: ${error.message}`); }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if(message.kind==='open-session-helper'){const s=await config(),u=new URL(sender.url||'http://invalid');if(u.origin!==`http://127.0.0.1:${s.port}`||u.pathname!=='/session-connect'||u.searchParams.get('request')!==message.requestId)throw Error('Invalid browser session request.');const pending=await bridge('/session-requests');if(!pending.requests.some(r=>r.id===message.requestId))throw Error('Session request expired.');await chrome.tabs.create({url:chrome.runtime.getURL('popup.html')+'?session='+message.requestId});return true;}
    if(['share-youtube','forget-youtube','session-state'].includes(message.kind)){if(!sender.url?.startsWith(chrome.runtime.getURL('')))throw Error('Open the extension to manage session sharing.');if(message.kind==='session-state')return bridge('/session-requests');if(message.kind==='forget-youtube'){await chrome.storage.local.set({youtubeRefresh:false,youtubeSharedAt:0});return bridge('/session-forget',{});}return shareYouTubeSession(message.requestId);}
    if (message.kind === 'settings') { const s = await config(); return { panels: s.panels }; }
    if (message.kind === 'health') return bridge('/health');
    if (message.kind === 'status') return bridge('/status');
    if (message.kind === 'media') {
      const id = sender.url?.startsWith(chrome.runtime.getURL('')) ? message.tabId ?? sender.tab?.id : sender.tab?.id;
      const stored = await chrome.storage.session.get(`media:${id}`); return { items: stored[`media:${id}`] || [] };
    }
    if (message.kind === 'download') {
      const input = { ...message.input };
      // Content scripts may add downloads, but cannot write arbitrary local paths.
      delete input.directory; delete input.scheduledAt;
      return addDownload(input);
    }
    if (message.kind === 'video-info') return bridge('/video-info', { url: message.url }, 100000);
    throw new Error('Unknown extension message.');
  })().then(value => sendResponse({ ok: true, value })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'odm-health') return;
  try {const s=await config();if(s.youtubeRefresh&&Date.now()-s.youtubeSharedAt>=30*60000){const current=await bridge('/session-requests');if(current.session.available&&current.session.sharedAt===s.youtubeSharedAt)await shareYouTubeSession(undefined,s.youtubeSharedAt);else await chrome.storage.local.set({youtubeRefresh:false});}const data = await bridge('/status'); const active = data.jobs.filter(j => ['downloading', 'probing', 'assembling'].includes(j.status)).length; await chrome.action.setBadgeText({ text: active ? String(active) : '' }); await chrome.action.setBadgeBackgroundColor({ color: '#0078d4' }); }
  catch { await chrome.action.setBadgeText({ text: '' }); }
});

async function shareYouTubeSession(requestId,refreshOf){if(!await chrome.permissions.contains({permissions:['cookies']}))throw Error('Allow cookies from the Share YouTube session button first.');const cookies=await chrome.cookies.getAll({domain:'youtube.com'});const {session}=await bridge('/session-share',{cookies,requestId,refreshOf,browser:'Chrome / Edge'});await chrome.storage.local.set({youtubeSharedAt:session.sharedAt});return session;}
