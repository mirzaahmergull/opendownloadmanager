'use strict';
(async () => {
  const send = message => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, result => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!result?.ok) return reject(new Error(result?.error || 'Extension unavailable.')); resolve(result.value);
    });
  });
  if(location.hostname==='127.0.0.1'&&location.pathname==='/session-connect'){const requestId=document.querySelector('#odm-session-request')?.dataset.request;if(/^[a-f0-9]{32}$/.test(requestId||''))await send({kind:'open-session-helper',requestId}).catch(()=>{});return;}
  const settings = await send({ kind: 'settings' }).catch(() => ({ panels: true }));
  if (!settings.panels) return;
  let active = null, hideTimer, busy = false;
  const host = document.createElement('div'); host.id = 'odm-video-download-panel';
  host.style.cssText = 'position:fixed;z-index:2147483647;display:none;pointer-events:auto;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>:host{all:initial}*{box-sizing:border-box}.controls{display:flex}button{font:12px Arial,sans-serif;cursor:pointer;color:#173847;background:linear-gradient(#f9ffed,#d9efae);border:1px solid #738e4c;border-radius:3px;height:28px;padding:3px 9px;box-shadow:0 1px 4px #0005;display:flex;gap:7px;align-items:center;white-space:nowrap}button:hover{background:#ecffce}button:disabled{opacity:.8;cursor:wait}.main{border-radius:3px 0 0 3px}.toggle{border-left:0;border-radius:0 3px 3px 0;padding:3px 7px}.arrow{font-size:16px;color:#398523}.message{background:#ffffe5;color:#333;font:11px Arial,sans-serif;border:1px solid #aaa;padding:8px;max-width:290px;line-height:1.5;margin-top:3px;border-radius:2px}.message:empty{display:none}.menu{border:1px solid #8f9d7b;background:#fcfff6;padding:3px;box-shadow:0 2px 5px #0004;margin-top:2px;min-width:204px}.menu button{border:0;border-radius:0;background:none;width:100%;box-shadow:none;height:28px;text-align:left}.menu button:hover{background:#e4f3cd}[hidden]{display:none!important}</style><div class="controls"><button class="main" title="Send video to Open Download Manager"><span class="arrow">⬇</span><span class="label">Download this video</span></button><button class="toggle" title="Choose video quality" aria-label="Choose video quality">▾</button></div><div class="menu" hidden></div><div class="message" role="status"></div>`;
  const button = shadow.querySelector('.main'), toggle = shadow.querySelector('.toggle'), qualityMenu = shadow.querySelector('.menu'), label = shadow.querySelector('.label'), message = shadow.querySelector('.message');
  function mount() { const root = document.fullscreenElement || document.body; if (host.parentNode !== root) root.appendChild(host); }
  function position() {
    if (!active || !active.isConnected) { host.style.display = 'none'; return; }
    const rect = active.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80 || rect.bottom < 0 || rect.top > innerHeight) { host.style.display = 'none'; return; }
    mount(); host.style.display = 'block'; host.style.left = `${Math.max(4, Math.min(innerWidth - 207, rect.right - 207))}px`; host.style.top = `${Math.max(3, rect.top + 7)}px`;
  }
  function show(video) { if (active !== video) { message.textContent = ''; label.textContent = 'Download this video'; qualityMenu.hidden = true; } active = video; clearTimeout(hideTimer); position(); }
  function hideLater() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!busy) host.style.display = 'none'; }, 1100); }
  const watched = new WeakSet();
  function scan() {
    for (const video of document.querySelectorAll('video')) {
      if (watched.has(video)) continue; watched.add(video);
      video.addEventListener('pointerenter', () => show(video)); video.addEventListener('pointermove', () => show(video)); video.addEventListener('pointerleave', hideLater);
      video.addEventListener('play', () => { show(video); hideLater(); });
    }
  }
  host.addEventListener('pointerenter', () => clearTimeout(hideTimer)); host.addEventListener('pointerleave', hideLater);
  async function download(event, chosenFormat = 'bestvideo*+bestaudio/best') {
    event.preventDefault(); event.stopPropagation(); if (!active || busy) return;
    busy = true; button.disabled = true; toggle.disabled = true; qualityMenu.hidden = true; label.textContent = 'Sending…'; message.textContent = '';
    try {
      const page = location.href;
      const youtube = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(location.hostname);
      let url = youtube ? page : active.currentSrc || active.src || active.querySelector('source')?.src;
      if (!/^https?:\/\//.test(url || '')) {
        const media = await send({ kind: 'media' }); const item = media.items.slice().reverse().find(i => /mpegurl|dash\+xml|video\//i.test(i.type) || /\.(m3u8|mpd|mp4|webm)(?:\?|$)/i.test(i.url)); url = item?.url || page;
      }
      const type = youtube || /\.(m3u8|mpd)(?:\?|$)/i.test(url) || url === page || chosenFormat === 'bestaudio/best' ? 'video' : 'file';
      const format = chosenFormat;
      await send({ kind: 'download', input: { url, type, format, headers: { Referer: page } } });
      label.textContent = 'Added to download manager'; message.textContent = 'Open the desktop app to view progress.';
    } catch (error) { label.textContent = 'Download this video'; message.textContent = error.message; }
    finally { busy = false; button.disabled = false; toggle.disabled = false; }
  }
  button.onclick = event => download(event);
  toggle.onclick = event => {
    event.preventDefault(); event.stopPropagation(); clearTimeout(hideTimer);
    if (!qualityMenu.hidden) { qualityMenu.hidden = true; return; }
    const direct = /^https?:\/\//.test(active?.currentSrc || '') && !/\.(m3u8|mpd)(?:\?|$)/i.test(active.currentSrc) && !/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(location.hostname);
    const options = direct ? [['Original video', 'bestvideo*+bestaudio/best'], ['Audio only · MP3', 'bestaudio/best']] : [['Best quality + audio', 'bestvideo*+bestaudio/best'], ['1080p + audio', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'], ['720p + audio', 'bestvideo[height<=720]+bestaudio/best[height<=720]'], ['Audio only · MP3', 'bestaudio/best']];
    qualityMenu.replaceChildren();
    for (const [text, format] of options) { const choice = document.createElement('button'); choice.textContent = text; choice.onclick = event => download(event, format); qualityMenu.appendChild(choice); }
    qualityMenu.hidden = false;
  };
  scan();
  // Player overlays (including YouTube controls) may receive pointer events instead of the video.
  document.addEventListener('pointermove', event => {
    if (host.contains(event.target)) return;
    for (const video of document.querySelectorAll('video')) {
      const rect = video.getBoundingClientRect();
      if (rect.width >= 120 && rect.height >= 80 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) { show(video); break; }
    }
  }, { passive: true, capture: true });
  let scanPending = false;
  new MutationObserver(() => { if (!scanPending) { scanPending = true; setTimeout(() => { scanPending = false; scan(); }, 200); } }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('scroll', () => { if (host.style.display !== 'none') position(); }, { passive: true, capture: true });
  addEventListener('resize', position); document.addEventListener('fullscreenchange', position);
})();
