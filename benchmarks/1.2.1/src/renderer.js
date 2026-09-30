'use strict';
const $ = selector => document.querySelector(selector);
const api = (name, ...args) => window.odm.invoke(name, ...args);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let state = { jobs: [], settings: {}, queues: [], categories: [] }, selected = new Set(), filter = 'all', search = '', sort = { key: 'createdAt', direction: -1 }, dialogKind = '', detailJobId = '', lastRows = '';
let lastWarning = '', lastTree='', filteredJobs=[], renderFrame=0;const rowCache=new Map();
const iconPaths = {
  add: '<circle cx="16" cy="16" r="13" fill="#4aa7df" stroke="#176da2"/><path d="M16 8v16M8 16h16" stroke="white" stroke-width="3"/>',
  resume: '<circle cx="16" cy="16" r="13" fill="#68b74c" stroke="#3f8230"/><path d="m12 8 12 8-12 8z" fill="white"/>',
  stop: '<circle cx="16" cy="16" r="13" fill="#e9b44e" stroke="#b58529"/><rect x="10" y="10" width="12" height="12" rx="1" fill="white"/>',
  stopAll: '<rect x="3" y="5" width="23" height="23" rx="3" fill="#c95942" stroke="#963b2a"/><rect x="9" y="1" width="21" height="22" rx="3" fill="#e9765a" stroke="#ad4933"/><rect x="15" y="7" width="9" height="10" fill="white"/>',
  remove: '<path d="m8 7 17 18m0-18L8 25" stroke="#aa3030" stroke-width="7"/><path d="m8 6 17 18m0-18L8 24" stroke="#e46b5b" stroke-width="4"/>',
  clear: '<path d="M9 8h16l-2 21H11z" fill="#bbc9d1" stroke="#647b88"/><path d="M7 8h20M13 4h8m-8 9v11m5-11v11m5-11v11" stroke="#617985" stroke-width="2"/>',
  options: '<path d="m14 2 4 0 1 4 4 2 4-1 2 4-3 3v4l3 3-2 4-4-1-4 2-1 4h-4l-1-4-4-2-4 1-2-4 3-3v-4l-3-3 2-4 4 1 4-2z" fill="#8ba4b6" stroke="#4d6e84"/><circle cx="16" cy="16" r="6" fill="#ecf0f2" stroke="#557c99"/>',
  scheduler: '<circle cx="16" cy="17" r="12" fill="#f8f3d9" stroke="#bda23c" stroke-width="2"/><path d="M16 8v10l7 3" stroke="#776628" stroke-width="2" fill="none"/><path d="m4 4 5-2m14 0 5 2" stroke="#ad8f23" stroke-width="3"/>',
  queue: '<rect x="3" y="4" width="24" height="25" rx="2" fill="#e1eaf0" stroke="#7b98ad"/><path d="M7 10h12m-12 6h9M7 22h7" stroke="#87a3b6" stroke-width="2"/><path d="m21 16 10 7-10 7z" fill="#61a747" stroke="#3f7b2a"/>',
  queueStop: '<rect x="3" y="4" width="24" height="25" rx="2" fill="#e1eaf0" stroke="#7b98ad"/><path d="M7 10h12m-12 6h9M7 22h7" stroke="#87a3b6" stroke-width="2"/><rect x="19" y="18" width="11" height="11" rx="1" fill="#d9674f" stroke="#963b2a"/>',
  grabber: '<circle cx="16" cy="16" r="12" fill="#69b4dc" stroke="#2c81b1"/><ellipse cx="16" cy="16" rx="6" ry="12" fill="none" stroke="#def3ff"/><path d="M4 16h24M6 10h20M6 22h20" stroke="#def3ff"/><path d="m22 17 7 4-3 7-3-4-4-1z" fill="#efe083" stroke="#927e2b"/>',
  browser: '<circle cx="16" cy="16" r="13" fill="#4ba5d6" stroke="#29799f"/><path d="M4 13h24M5 21h23M16 3c-8 9-8 17 0 26m0-26c8 9 8 17 0 26" stroke="#d5f0ff" fill="none"/>',
  folder: '<path d="M3 8V5h11l3 4h12v18H3z" fill="#efd578" stroke="#baa044"/><path d="M3 12h27l-3 15H2z" fill="#ffe39a" stroke="#baa044"/>',
  file: '<path d="M7 2h13l7 7v21H7z" fill="#f8fafc" stroke="#7d9ab0"/><path d="M20 2v7h7M11 14h12m-12 5h12m-12 5h8" stroke="#92aec2" fill="none"/>',
  video: '<rect x="3" y="5" width="26" height="22" rx="2" fill="#c0a4db" stroke="#83639f"/><path d="m12 10 10 6-10 6z" fill="white"/><path d="M6 6v20m20-20v20" stroke="#806092" stroke-dasharray="2 3"/>',
  music: '<path d="M13 24V8l14-4v17" fill="none" stroke="#7a7ecc" stroke-width="3"/><ellipse cx="8" cy="25" rx="6" ry="4" fill="#7a7ecc"/><ellipse cx="22" cy="22" rx="6" ry="4" fill="#7a7ecc"/>',
  programs: '<rect x="3" y="4" width="26" height="21" rx="2" fill="#cee2ed" stroke="#6e92a7"/><path d="M3 9h26M12 29h8M16 25v4" stroke="#6e92a7"/><path d="m10 13-3 3 3 3m12-6 3 3-3 3" fill="none" stroke="#5796bd" stroke-width="2"/>',
  compressed: '<path d="M6 2h15l6 7v21H6z" fill="#eac48f" stroke="#b28853"/><path d="M15 2v19" stroke="#8a6f51" stroke-width="3" stroke-dasharray="2 2"/><rect x="13" y="20" width="5" height="7" rx="1" fill="#c49e6c" stroke="#846749"/>',
  complete: '<circle cx="16" cy="16" r="13" fill="#80ba66" stroke="#527f3e"/><path d="m8 16 5 5 11-12" stroke="white" stroke-width="3" fill="none"/>',
  paused: '<circle cx="16" cy="16" r="13" fill="#edcc71" stroke="#ad913d"/><path d="M12 9v14m8-14v14" stroke="white" stroke-width="4"/>',
  error: '<circle cx="16" cy="16" r="13" fill="#d76a5e" stroke="#a64d43"/><path d="M16 7v12m0 3v3" stroke="white" stroke-width="3"/>'
};
function icon(name) { return `<svg viewBox="0 0 32 32" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`; }
function jobIcon(job) { return job.status === 'error' ? 'error' : ({ Video: 'video', Music: 'music', Programs: 'programs', Compressed: 'compressed', Documents: 'file' }[job.category] || 'file'); }
function bytes(value) { if (value === null || value === undefined) return 'Unknown'; if (!value) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`; }
function duration(value) { if (value === null || !Number.isFinite(value)) return '—'; value = Math.ceil(value); return value >= 3600 ? `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m` : value >= 60 ? `${Math.floor(value / 60)}m ${value % 60}s` : `${value}s`; }
function percent(job) { return job.status === 'complete' ? 100 : job.size ? Math.min(100, job.downloaded / job.size * 100) : 0; }
function statusText(job) { return ({ complete: 'Complete', downloading: `${percent(job).toFixed(2)}%`, probing: 'Connecting…', assembling: 'Assembling…', paused: 'Stopped', queued: job.scheduledAt && new Date(job.scheduledAt) > new Date() ? 'Scheduled' : 'Queued', error: 'Error' }[job.status] || job.status); }
function currentJob() { return state.jobs.find(j => selected.has(j.id)); }
function toast(message, error = false) { $('#toast').textContent = message; $('#toast').className = error ? 'error' : ''; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, error ? 8000 : 4000); }
async function attempt(fn) { try { return await fn(); } catch (error) { if(error.message!=='Inspection cancelled.')toast(error.message, true); } }
const tools = [
  ['add', 'Add URL', 'Ctrl+N'], ['resume', 'Resume', 'Enter'], ['stop', 'Stop', 'Pause selected downloads'], ['stopAll', 'Stop All', 'Stop all downloads'], '|',
  ['remove', 'Delete', 'Delete from list; keep completed files'], ['clear', 'Delete Completed', 'Clear completed downloads from the list'], '|',
  ['options', 'Options', 'Configure downloads'], ['scheduler', 'Scheduler', 'Queues and scheduling'], ['queue', 'Start Queue', 'Start the main queue'], ['queueStop', 'Stop Queue', 'Stop the main queue'], '|',
  ['grabber', 'Grabber', 'Find downloadable links on a page'], ['browser', 'Integration', 'Connect your browser']
];
$('#toolbar').innerHTML = tools.map(t => t === '|' ? '<div class="tool-separator"></div>' : `<button class="tool" data-action="${t[0]}" title="${t[2]}">${icon(t[0])}<span>${t[1]}</span></button>`).join('');
$('#empty-icon').innerHTML = icon('folder');
function renderTree() {
  const rows = [ ['all', 'All Downloads', 'folder', false], ['active','Downloading','resume',false],['paused','Paused','paused',false],['complete','Completed','complete',false],['error','Failed','error',false], ...state.categories.map(c => [c.name, c.name, ({ Compressed: 'compressed', Documents: 'file', Music: 'music', Programs: 'programs', Video: 'video' }[c.name] || 'folder'), true]), ...state.queues.map(q => [`queue:${q.name}`, q.name, 'queue', true]) ];
  const treeHTML = rows.map(([id, label, image, child], i) => {
    const count = state.jobs.filter(j => matches(j, id)).length;
    return `${i===5?'<div class="tree-section">File types</div>':i===5+state.categories.length?'<div class="tree-section">Queues</div>':''}<div class="tree-row${filter === id ? ' selected' : ''}${child ? ' child' : ''}${i === 7 || i === 10 ? ' group' : ''}" data-filter="${esc(id)}" role="treeitem" tabindex="${filter===id?0:-1}" aria-selected="${filter === id}">${child ? '' : '<span class="tree-arrow">▾</span>'}${icon(image)}<span>${esc(label)}</span><span class="tree-count">${count || ''}</span></div>`;
  }).join('');if(treeHTML!==lastTree){$('#tree').innerHTML=treeHTML;lastTree=treeHTML;}
}
function matches(job, value) { if (value === 'all') return true;if(value==='active')return ['downloading','probing','assembling','queued'].includes(job.status);if(value==='paused')return job.status==='paused'; if (value === 'unfinished') return job.status !== 'complete'; if (['complete', 'error'].includes(value)) return job.status === value; if (value.startsWith('queue:')) return job.queue === value.slice(6) && job.status !== 'complete'; return job.category === value; }
function segmentHTML(job) { return job.segments?.length ? job.segments.map(s => `<div class="segment" title="Connection ${s.index + 1}: ${bytes(s.done)}"><div style="width:${s.end === null ? 0 : Math.min(100, s.done / Math.max(1, s.end - s.start + 1) * 100)}%"></div></div>`).join('') : `<span>${job.type === 'video' ? 'Video engine manages stream connections' : 'Waiting for connection'}</span>`; }
function render(progressOnly=false) {
  if (state.loadWarning && state.loadWarning !== lastWarning) toast(state.loadWarning, true);
  lastWarning = state.loadWarning;
  if (!progressOnly && selected.size) { const existing = new Set(state.jobs.map(j => j.id)); selected = new Set([...selected].filter(id => existing.has(id))); }
  if(!progressOnly)renderTree();
  const visible = progressOnly && !['size','speed','eta','status'].includes(sort.key) ? filteredJobs : state.jobs.filter(j => matches(j, filter) && `${j.filename} ${j.url} ${j.description}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => typeof a[sort.key] === 'number' || typeof b[sort.key] === 'number' ? ((a[sort.key] || 0) - (b[sort.key] || 0)) * sort.direction : String(a[sort.key] || '').localeCompare(String(b[sort.key] || '')) * sort.direction);
  $('#list-title').textContent = filter === 'all' ? 'All Downloads' : filter === 'unfinished' ? 'Unfinished Downloads' : filter === 'active' ? 'Downloading' : filter === 'paused' ? 'Paused' : filter === 'complete' ? 'Completed' : filter === 'error' ? 'Failed Downloads' : filter.replace('queue:', '');
  filteredJobs=visible;renderRows(visible);
  $('#empty-state').hidden = visible.length > 0;
  $('#empty-state b').textContent = search?'No matching downloads':state.jobs.length?'Nothing here yet':'Ready when you are';$('#empty-state p').innerHTML=search?'Try another search or clear the search field.':state.jobs.length?'Downloads in this section will appear here.':'Files, videos and playlists — all organized here.<br>Paste a link to get started, or connect your browser.';
  const current = currentJob();$('#selection-actions').hidden=!selected.size;$('#selection-label').textContent=`${selected.size} selected`;$('#details').hidden=!current || localStorage.getItem('odm-details')==='hidden';
  const selectionJobs = selected.size ? state.jobs.filter(j => selected.has(j.id)) : [];
  $('[data-action="resume"]').disabled = !selectionJobs.some(j => ['paused', 'error', 'queued'].includes(j.status));
  $('[data-action="stop"]').disabled = !selectionJobs.some(j => ['downloading', 'probing', 'queued', 'assembling'].includes(j.status));
  $('[data-action="remove"]').disabled = !selectionJobs.length;
  $('[data-action="clear"]').disabled = !state.jobs.some(j => j.status === 'complete');
  $('[data-action="stopAll"]').disabled = !state.jobs.some(j => ['downloading', 'probing', 'queued', 'assembling'].includes(j.status));
  $('#status-count').textContent = `${visible.length} download${visible.length === 1 ? '' : 's'}${selected.size ? ` · ${selected.size} selected` : ''}`;
  const active = state.jobs.filter(j => ['downloading', 'probing', 'assembling'].includes(j.status));
  $('#status-active').textContent = active.length ? `${active.length} active · ${state.jobs.filter(j => j.status === 'queued').length} queued` : 'Ready';
  if($('#activity-indicator'))$('#activity-indicator').innerHTML=active.length?`<i></i>${active.length} active · ${bytes(active.reduce((sum,j)=>sum+j.speed,0))}/s`:'No active transfers';
  $('#status-speed').textContent = `${bytes(active.reduce((sum, j) => sum + j.speed, 0))}/s`;
  $('#limit-status').textContent = state.settings.speedLimit ? `Speed limiter: ${state.settings.speedLimit} KB/s` : 'Speed limiter: OFF';
  $('#detail-name').textContent = current?.filename || 'Download information';
  $('#detail-status').textContent = current ? `${statusText(current)}${current.speed ? ` · ${bytes(current.speed)}/s` : ''}` : 'Select a download to view its details';
  $('#detail-url').textContent = current?.url || '—'; $('#detail-path').textContent = current?.output || current?.directory || '—';
  $('#detail-progress').style.width = current ? `${percent(current)}%` : '0%';
  $('#detail-percent').textContent = current ? `${percent(current).toFixed(1)}%` : '—';
  $('#detail-segments').innerHTML = current ? segmentHTML(current) : '<span>—</span>';
  if (dialogKind === 'progress') renderProgress();
}
function closeDialog() { $('#dialog').close(); dialogKind = ''; detailJobId = ''; }
function showDialog(title, body, buttons, kind = '') {
  dialogKind = kind; $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = body; $('#dialog-footer').innerHTML = '';
  for (const item of buttons || [{ text: 'Close', click: closeDialog }]) {
    const b = document.createElement('button'); b.textContent = item.text; b.className = item.primary ? 'primary' : ''; if (item.id) b.id = item.id;
    b.onclick = () => attempt(async () => { b.disabled = true; try { await item.click(); } finally { if (b.isConnected) b.disabled = false; } }); $('#dialog-footer').append(b);
  }
  if (!$('#dialog').open) $('#dialog').showModal();
  requestAnimationFrame(() => $('#dialog-body input:not([type=checkbox])')?.focus());
}
function queueOptions(selectedName) { return state.queues.map(q => `<option value="${esc(q.name)}"${selectedName === q.name ? ' selected' : ''}>${esc(q.name)}</option>`).join(''); }
function addDialog(url = '') {
  showDialog('Add new download', `<div class="form"><label for="add-url">Address</label><input id="add-url" value="${esc(url)}" placeholder="https://example.com/file.zip"><label for="add-name">File name</label><input id="add-name" placeholder="Automatic from server"><label for="add-type">Download type</label><select id="add-type"><option value="auto">Automatic detection</option><option value="file">File download</option><option value="video">Video / stream (yt-dlp)</option></select><label for="add-category">Category</label><select id="add-category"><option value="">Automatic</option>${state.categories.map(c => `<option>${esc(c.name)}</option>`).join('')}</select><label for="add-folder">Save to</label><div class="field-row"><input id="add-folder" placeholder="${esc(state.settings.downloadDir)}"><button id="browse-folder">…</button></div><label for="add-queue">Queue</label><select id="add-queue">${queueOptions()}</select><label for="add-description">Description</label><input id="add-description"><label for="add-schedule">Start at</label><input id="add-schedule" type="datetime-local"><div class="full"><label class="check-row"><input id="use-auth" type="checkbox">Use authorization</label><div id="auth-fields" class="field-row" hidden><input id="auth-user" placeholder="Username" autocomplete="off"><input id="auth-password" placeholder="Password" type="password" autocomplete="off"></div><p class="help-text">YouTube and streaming URLs use the video engine. Direct file URLs use parallel HTTP connections.</p><button id="inspect-video">Choose video quality…</button><div id="video-choice" hidden></div></div></div>`, [
    { text: 'Download Later', click: () => submit(false) }, { text: 'Start Download', primary: true, id: 'start-download', click: () => submit(true) }, { text: 'Cancel', click: closeDialog }
  ], 'add');
  $('#dialog-body .form').insertAdjacentHTML('beforeend', '<fieldset class="section-box full"><legend>File verification and mirrors</legend><label>Expected SHA-256 (optional)</label><input id="add-checksum" class="large-url" placeholder="64 hexadecimal characters"><label>Mirror addresses (one per line, optional)</label><textarea id="add-mirrors" class="large-url" style="min-height:50px"></textarea><p class="help-text">Mirrors are tried if the primary file address fails. Switching mirrors restarts the transfer safely.</p></fieldset>');
  $('#browse-folder').onclick = () => attempt(async () => { const folder = await api('choose-folder'); if (folder) $('#add-folder').value = folder; });
  $('#use-auth').onchange = () => $('#auth-fields').hidden = !$('#use-auth').checked;
  $('#inspect-video').onclick = () => attempt(async () => {
    if (!$('#add-url').value.trim()) throw new Error('Enter a video URL first.');
    $('#inspect-video').disabled = true; $('#inspect-video').textContent = 'Reading video formats…';
    try {
      const info = await inspectAPI('video-info', $('#add-url').value.trim());
      $('#add-type').value = 'video'; if (!$('#add-name').value) $('#add-name').value = info.title;
      $('#video-choice').hidden = false;
      $('#video-choice').innerHTML = `<p>${esc(info.title)} · ${duration(info.duration)}</p><select id="video-format" class="video-formats"><option value="bestvideo*+bestaudio/best">Best quality · video + audio</option><option value="bestvideo[height<=1080]+bestaudio/best[height<=1080]">Up to 1080p · video + audio</option><option value="bestvideo[height<=720]+bestaudio/best[height<=720]">Up to 720p · video + audio</option><option value="bestaudio/best">Audio only</option>${info.formats.slice().reverse().map(f => `<option value="${esc(f.id)}">${esc(f.height ? `${f.height}p` : 'Audio')} · ${esc(f.ext)} · ${f.audio ? 'with audio' : 'video only'}${f.size ? ` · ${bytes(f.size)}` : ''}</option>`).join('')}</select>`;
    } finally { if ($('#inspect-video')) { $('#inspect-video').disabled = false; $('#inspect-video').textContent = 'Choose video quality…'; } }
  });
  async function submit(start) {
    const user = $('#auth-user').value, password = $('#auth-password').value; const headers = {};
    if ($('#use-auth').checked) headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${password}`)));
    const j = await api('add', { url: $('#add-url').value.trim(), filename: $('#add-name').value.trim(), type: $('#add-type').value, category: $('#add-category').value, directory: $('#add-folder').value.trim(), queue: $('#add-queue').value, description: $('#add-description').value, scheduledAt: $('#add-schedule').value ? new Date($('#add-schedule').value).toISOString() : '', format: $('#video-format')?.value, expectedChecksum: $('#add-checksum').value.trim(), mirrors: $('#add-mirrors').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean), headers, start });
    selected = new Set([j.id]); filter = 'all'; closeDialog(); toast(start ? 'Download added.' : 'Saved for later. Select it and click Resume to start.'); await refresh(); if(start)toast('Download started. You can keep browsing your library.');
  }
}
function batchDialog() {
  showDialog('Add batch downloads', '<p>Paste one HTTP or HTTPS URL per line.</p><textarea id="batch-urls" class="batch-urls" placeholder="https://example.com/file1.zip\nhttps://example.com/file2.pdf"></textarea><label class="check-row"><input id="batch-start" type="checkbox" checked>Start downloading immediately</label>', [
    { text: 'Add Downloads', primary: true, click: async () => { const urls = [...new Set($('#batch-urls').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean))]; if (!urls.length || urls.length > 200) throw new Error('Paste between 1 and 200 URLs.'); for (const url of urls) { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.'); } const start = $('#batch-start').checked; await api('add-batch', urls, start); closeDialog(); toast(`${urls.length} downloads added.`); } }, { text: 'Cancel', click: closeDialog }
  ], 'batch');
}
function optionsDialog(tab = 'General', draft = structuredClone(state.settings)) {
  const s = draft;
  let body = '';
  if (tab === 'General') body = `<fieldset class="section-box"><legend>System integration</legend><label class="check-row"><input id="opt-tray" type="checkbox" ${s.minimizeToTray ? 'checked' : ''}>Close the main window to the system tray</label><label class="check-row"><input id="opt-startup" type="checkbox" ${s.startAtLogin ? 'checked' : ''}>Launch Open Download Manager at login</label><label class="check-row"><input id="opt-clipboard" type="checkbox" ${s.clipboard ? 'checked' : ''}>Monitor clipboard for downloadable URLs</label></fieldset><fieldset class="section-box"><legend>Browser integration</legend><p class="help-text">The companion extension adds video download panels, context menu actions, and optional automatic capture.</p><button id="opt-integration">Configure browser integration…</button></fieldset>`;
  if (tab === 'Connection') body = `<fieldset class="section-box"><legend>Connection settings</legend><div class="setting-row"><label>Default maximum connections</label><select id="opt-connections">${[1, 2, 4, 8, 16, 32].map(n => `<option ${s.connections === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="setting-row"><label>Concurrent downloads</label><input id="opt-concurrent" type="number" min="1" max="16" value="${s.concurrent}"></div><p class="help-text">Multiple connections require byte-range support. Some servers limit the number of connections or do not allow resume.</p></fieldset><fieldset class="section-box"><legend>Speed limiter</legend><div class="setting-row"><label>Global limit (KB/s, 0 = unlimited)</label><input id="opt-speed" type="number" min="0" value="${s.speedLimit}"></div><p class="help-text">The limit is shared across direct file transfers. Video transfers receive a per-process share when started.</p></fieldset>`;
  if (tab === 'Save To') body = `<fieldset class="section-box"><legend>Default download folder</legend><div class="field-row"><input id="opt-folder" value="${esc(s.downloadDir)}"><button id="opt-browse">Browse…</button></div><label class="check-row"><input id="opt-categorize" type="checkbox" ${s.categorize ? 'checked' : ''}>Automatically save files into category subfolders</label></fieldset><p class="help-text">New downloads use this folder. Existing downloads keep their current destination. Files with the same name receive a numeric suffix.</p>`;
  if (tab === 'Downloads') body = `<fieldset class="section-box"><legend>Error recovery</legend><div class="setting-row"><label>Automatic retry attempts</label><input id="opt-retries" type="number" min="0" max="10" value="${s.retries}"></div><p class="help-text">Partial files persist between sessions. If the server changes the file or does not supply a stable validator, resume restarts safely.</p></fieldset><div class="notice">Every completed file receives a SHA-256 checksum. View it in Properties.</div><label class="check-row"><input id="opt-extract" type="checkbox" ${s.autoExtract ? 'checked' : ''}>Automatically extract completed ZIP archives</label>`;
  if (tab === 'Proxy / SOCKS') body = `<fieldset class="section-box"><legend>Proxy server</legend><label for="opt-proxy">Proxy URL (leave blank for a direct connection)</label><input id="opt-proxy" class="large-url" type="password" value="${esc(s.proxyURL || '')}" placeholder="http://127.0.0.1:8080"><label class="check-row"><input id="show-proxy" type="checkbox">Show proxy address</label><p class="help-text">Supported: HTTP, HTTPS, SOCKS4, SOCKS4a, SOCKS5, SOCKS5h.<br>Authentication: http://username:password@proxy.example:8080<br>Changes apply to new connections. Video downloads use the same proxy.</p></fieldset>`;
  if (tab === 'File Types') body = `<fieldset class="section-box"><legend>Automatic categories</legend><div class="download-stats">${state.categories.map(c => `<span>${esc(c.name)}</span><span>${esc(c.extensions.join(' ') || 'All other file types')}</span>`).join('')}</div><button id="manage-categories">Edit categories…</button><button id="create-category">New category…</button></fieldset><p class="help-text">Choose a different category in the Add Download dialog. Browser interception is configured in the extension popup.</p>`;
  showDialog('Options', `<div class="tabs">${['General', 'File Types', 'Connection', 'Save To', 'Downloads', 'Proxy / SOCKS'].map(t => `<button data-tab="${t}" class="${tab === t ? 'active' : ''}">${t}</button>`).join('')}</div>${body}`, [
    { text: 'OK', primary: true, click: async () => { await saveOptions(); closeDialog(); } }, { text: 'Apply', click: async () => { await saveOptions(); toast('Settings saved.'); } }, { text: 'Cancel', click: closeDialog }
  ], 'options');
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { Object.assign(draft, captureOptions()); optionsDialog(b.dataset.tab, draft); });
  if ($('#opt-integration')) $('#opt-integration').onclick = integrationDialog;
  if ($('#manage-categories')) $('#manage-categories').onclick = () => categoryDialog(state.categories[0].name);
  if ($('#create-category')) $('#create-category').onclick = () => categoryDialog();
  if ($('#show-proxy')) $('#show-proxy').onchange = event => { $('#opt-proxy').type = event.target.checked ? 'text' : 'password'; };
  if ($('#opt-browse')) $('#opt-browse').onclick = () => attempt(async () => { const folder = await api('choose-folder'); if (folder) $('#opt-folder').value = folder; });
  async function saveOptions() {
    Object.assign(draft, captureOptions()); await api('settings', draft);
  }
  function captureOptions() {
    const value = {};
    const fields = { 'opt-tray': ['minimizeToTray', 'check'], 'opt-startup': ['startAtLogin', 'check'], 'opt-clipboard': ['clipboard', 'check'], 'opt-connections': ['connections', 'number'], 'opt-concurrent': ['concurrent', 'number'], 'opt-speed': ['speedLimit', 'number'], 'opt-folder': ['downloadDir', 'text'], 'opt-categorize': ['categorize', 'check'], 'opt-retries': ['retries', 'number'], 'opt-extract': ['autoExtract', 'check'] };
    for (const [id, [key, type]] of Object.entries(fields)) if ($(`#${id}`)) value[key] = type === 'check' ? $(`#${id}`).checked : type === 'number' ? Number($(`#${id}`).value) : $(`#${id}`).value;
    if ($('#opt-proxy')) value.proxyURL = $('#opt-proxy').value.trim();
    return value;
  }
}
function categoryDialog(name = '') {
  const category = state.categories.find(c => c.name === name);
  showDialog(category ? 'Edit category' : 'New category', `<div class="form">${category ? `<label>Category</label><select id="category-select">${state.categories.map(c => `<option ${c.name === name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}<label>Name</label><input id="category-name" value="${esc(category?.name || '')}" ${name === 'Other' ? 'readonly' : ''}><label>File extensions</label><input id="category-types" value="${esc(category?.extensions.join(' ') || '')}" placeholder="zip 7z rar"><label>Save to</label><div class="field-row"><input id="category-folder" value="${esc(category?.directory || '')}" placeholder="Default download folder / category"><button id="category-browse">…</button></div><p class="help-text full">Extensions are separated by spaces. Folder changes apply to new downloads. Existing files and partial data keep their locations.</p></div>`, [
    ...(category && name !== 'Other' ? [{ text: 'Delete category', click: async () => { await api('remove-category', name); filter = 'all'; closeDialog(); } }] : []),
    { text: 'Save', primary: true, click: async () => { const newName = await api('category', { oldName: name, name: $('#category-name').value.trim(), extensions: $('#category-types').value, directory: $('#category-folder').value }); filter = newName; closeDialog(); toast('Category saved.'); } }, { text: 'Cancel', click: closeDialog }
  ], 'category');
  if ($('#category-select')) $('#category-select').onchange = event => categoryDialog(event.target.value);
  $('#category-browse').onclick = () => attempt(async () => { const folder = await api('choose-folder'); if (folder) $('#category-folder').value = folder; });
}
async function integrationDialog() {
  const info = await api('integration');
  showDialog('Browser integration', `<div class="notice"><b>${info.connected ? 'Extension connected' : 'Connect Chrome or Microsoft Edge'}</b><br>The app must be running while you use the extension.</div><ol class="setup-steps"><li>Open <b>chrome://extensions</b> or <b>edge://extensions</b> in your browser.</li><li>Turn on <b>Developer mode</b>, click <b>Load unpacked</b>, and select this folder:<div class="path-box">${esc(info.extensionPath)}</div><button id="open-extension-folder">Open extension folder</button></li><li>Open the extension popup, paste this pairing token, and click <b>Connect</b>:<div class="field-row"><input id="pair-token" class="token" readonly value="${esc(info.token)}"><button id="copy-token">Copy</button></div></li><li>Play a video and hover over it. Click <b>Download this video</b>, or right-click a file link and choose <b>Download with Open Download Manager</b>.</li></ol><p class="help-text">Automatic browser download capture is optional and off by default. Enable it in the extension popup after pairing.</p>`, [{ text: 'Close', click: closeDialog }], 'integration');
  $('#copy-token').onclick = () => attempt(async () => { await api('copy', info.token); toast('Pairing token copied.'); });
  $('#open-extension-folder').onclick = () => api('extension-folder');
}
function progressDialog(id) {
  detailJobId = id;
  showDialog('Download status', '<div id="progress-content" class="detail-dialog"></div>', [
    { text: 'Show in Folder', click: () => api('show-file', id) }, { text: 'Pause', id: 'progress-pause', click: async () => { const job = state.jobs.find(j => j.id === id); await api(job.status === 'paused' || job.status === 'error' ? 'resume' : 'pause', id); } }, { text: 'Close', click: closeDialog }
  ], 'progress'); renderProgress();
}
function renderProgress() {
  const j = state.jobs.find(j => j.id === detailJobId); if (!j || !$('#progress-content')) return;
  $('#dialog-title').textContent = `${percent(j).toFixed(1)}% — ${j.filename}`;
  $('#progress-content').innerHTML = `<div class="tabs"><button class="active">Download status</button><button id="progress-limiter">Speed Limiter</button></div><input class="large-url" readonly value="${esc(j.url)}"><div class="download-stats"><span>Status</span><span>${esc(j.status === 'downloading' ? 'Receiving data…' : statusText(j))}</span><span>File size</span><span>${bytes(j.size)}</span><span>Downloaded</span><span>${bytes(j.downloaded)} (${percent(j).toFixed(2)}%)</span><span>Transfer rate</span><span>${bytes(j.speed)}/s</span><span>Time left</span><span>${duration(j.eta)}</span><span>Resume capability</span><span>${j.resumable ? 'Yes' : 'No'}</span></div><div class="progress download-progress"><div style="width:${percent(j)}%"></div></div><h4>Download progress by connection</h4><div class="segments">${segmentHTML(j)}</div>${j.error ? `<p class="error-box">${esc(j.error)}</p>` : ''}${j.postProcess ? `<p class="notice">${esc(j.postProcess)}</p>` : ''}${j.type === 'torrent' ? `<p class="help-text">${j.peers || 0} peers · ${bytes(j.uploaded || 0)} uploaded</p>` : ''}${j.checksum ? `<p class="help-text">SHA-256</p><div class="hash">${esc(j.checksum)}</div>` : ''}`;
  $('#progress-limiter').onclick = () => optionsDialog('Connection');
  $('#progress-pause').textContent = j.status === 'paused' || j.status === 'error' ? 'Resume' : 'Pause';
  $('#progress-pause').disabled = j.status === 'complete';
}
function propertiesDialog(id) {
  const j = state.jobs.find(j => j.id === id); if (!j) return;
  const active = ['downloading', 'probing', 'assembling'].includes(j.status);
  showDialog('Download properties', `<div class="form"><label>Address</label><input id="prop-url" value="${esc(j.url)}" ${active || j.status === 'complete' ? 'readonly' : ''}><label>File name</label><input id="prop-name" value="${esc(j.filename)}" ${active || j.status === 'complete' ? 'readonly' : ''}><label>Description</label><input id="prop-description" value="${esc(j.description)}"><label>Queue</label><select id="prop-queue">${queueOptions(j.queue)}</select><label>Start at</label><input id="prop-schedule" type="datetime-local" value="${esc(j.scheduledAt ? localDate(j.scheduledAt) : '')}"><label>Save to</label><div class="path-box">${esc(j.output || j.directory)}</div><label>SHA-256</label><div class="hash">${esc(j.checksum || 'Available after completion for direct file downloads')}</div><div class="full help-text">${active ? 'Pause the download before editing properties.' : 'Changing the URL resets partial transfer data. Completed files stay on disk when removed from the list.'}</div></div>`, [
    { text: 'OK', primary: true, click: async () => { if (active) throw new Error('Pause the download before editing its properties.'); await api('update-job', id, { url: $('#prop-url').value, filename: $('#prop-name').value, description: $('#prop-description').value, queue: $('#prop-queue').value, scheduledAt: $('#prop-schedule').value ? new Date($('#prop-schedule').value).toISOString() : '' }); closeDialog(); } }, { text: 'Cancel', click: closeDialog }
  ], 'properties');
}
function localDate(value) { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function schedulerDialog(name = state.queues[0].name, selectedQueueJob = '') {
  const q = state.queues.find(q => q.name === name);
  showDialog('Scheduler', `<div class="queue-list"><div class="queue-names">${state.queues.map(q => `<button data-queue-name="${esc(q.name)}" class="${q.name === name ? 'active' : ''}">${esc(q.name)}</button>`).join('')}<button id="new-queue">+ New queue…</button></div><div class="queue-panel"><h3>${esc(name)}</h3><label class="check-row"><input id="queue-enabled" type="checkbox" ${q.enabled ? 'checked' : ''}>Queue enabled</label><fieldset class="section-box"><legend>Schedule</legend><div class="setting-row"><label>Start queue at</label><input id="queue-start" type="datetime-local" value="${q.startAt ? localDate(q.startAt) : ''}"></div><div class="setting-row"><label>Stop queue at</label><input id="queue-stop" type="datetime-local" value="${q.stopAt ? localDate(q.stopAt) : ''}"></div><label class="check-row"><input id="queue-daily" type="checkbox" ${q.daily ? 'checked' : ''}>Repeat every day</label><div class="setting-row"><label>Files at a time in this queue</label><input id="queue-concurrent" type="number" min="1" max="16" value="${q.concurrent || state.settings.concurrent}"></div></fieldset><p class="help-text">Files in the queue (${state.jobs.filter(j => j.queue === name && j.status !== 'complete').length})</p><div class="queue-files">${state.jobs.filter(j => j.queue === name && j.status !== 'complete').map(j => `<button class="queue-file ${selectedQueueJob === j.id ? 'active' : ''}" data-queue-job="${j.id}">${esc(j.filename)} · ${esc(statusText(j))}</button>`).join('') || 'No pending files'}</div><div class="field-row" style="margin-top:7px"><button id="queue-up" ${!selectedQueueJob ? 'disabled' : ''}>↑ Move up</button><button id="queue-down" ${!selectedQueueJob ? 'disabled' : ''}>↓ Move down</button></div><p class="help-text">Scheduled starts include stopped files in this queue. The app must remain running. The global concurrency limit still applies.</p></div></div>`, [
    { text: 'Start now', click: async () => { await saveQueue(true); await api('queue-start', name); closeDialog(); } },
    { text: 'Stop now', click: async () => { await saveQueue(false); await api('queue-stop', name); closeDialog(); } },
    { text: 'Apply', primary: true, click: async () => { await saveQueue(); toast('Queue schedule saved.'); } }, { text: 'Close', click: closeDialog }
  ], 'scheduler');
  document.querySelectorAll('[data-queue-name]').forEach(b => b.onclick = () => schedulerDialog(b.dataset.queueName));
  document.querySelectorAll('[data-queue-job]').forEach(b => b.onclick = () => attempt(async () => { await saveQueue(); schedulerDialog(name, b.dataset.queueJob); }));
  for (const direction of ['up', 'down']) $(`#queue-${direction}`).onclick = () => attempt(async () => { await api('move-job', selectedQueueJob, direction); schedulerDialog(name, selectedQueueJob); });
  $('#new-queue').onclick = () => {
    showDialog('New download queue', '<label>Queue name</label><input id="new-queue-name" class="large-url" placeholder="My queue">', [{ text: 'Create', primary: true, click: async () => { const newName = $('#new-queue-name').value.trim(); await api('queue', { name: newName, enabled: false }); await refresh(); schedulerDialog(newName); } }, { text: 'Cancel', click: () => schedulerDialog(name) }]);
  };
  async function saveQueue(enabled) { await api('queue', { name, enabled: enabled === undefined ? $('#queue-enabled').checked : enabled, startAt: $('#queue-start').value ? new Date($('#queue-start').value).toISOString() : '', stopAt: $('#queue-stop').value ? new Date($('#queue-stop').value).toISOString() : '', daily: $('#queue-daily').checked, concurrent: Number($('#queue-concurrent').value) }); }
}
function grabberDialog() {
  showDialog('Site Grabber', '<p>Find direct downloadable links on a webpage.</p><div class="field-row"><input id="grab-url" placeholder="https://example.com/downloads"><button id="grab-scan">Scan page</button></div><p class="help-text">Scans this page only. JavaScript-generated links and authenticated pages may require the browser extension.</p><div id="grab-results" class="grab-results" hidden></div>', [
    { text: 'Download selected', primary: true, click: async () => { const checked = [...document.querySelectorAll('[data-grab-url]:checked')]; if (!checked.length) throw new Error('Scan a page and select files first.'); await api('add-batch', checked.map(box => box.dataset.grabUrl), true); closeDialog(); toast(`${checked.length} downloads added.`); } }, { text: 'Close', click: closeDialog }
  ], 'grabber');
  $('#grab-scan').onclick = () => attempt(async () => { $('#grab-scan').disabled = true; $('#grab-scan').textContent = 'Scanning…'; try { const links = await api('grab', $('#grab-url').value.trim()); $('#grab-results').hidden = false; $('#grab-results').innerHTML = links.map(l => `<label><input type="checkbox" checked data-grab-url="${esc(l.url)}"><span title="${esc(l.url)}">${esc(l.filename)}</span></label>`).join('') || 'No direct file links found on this page.'; } finally { if ($('#grab-scan')) { $('#grab-scan').disabled = false; $('#grab-scan').textContent = 'Scan page'; } } });
}
function confirmDelete(ids) {
  if (!ids.length) return;
  showDialog('Delete downloads', `<p>Remove ${ids.length} download${ids.length === 1 ? '' : 's'} from the list?</p><p class="help-text">Completed files stay on disk. Partial download data will be discarded.</p>`, [{ text: 'Delete', primary: true, click: async () => { await api('remove-many', ids); closeDialog(); } }, { text: 'Cancel', click: closeDialog }]);
}
const actions = {
  add: () => addDialog(), batch: batchDialog, resume: () => api('resume-many', [...selected]), stop: () => api('pause-many', [...selected]), stopAll: () => api('pause-all'), remove: () => confirmDelete([...selected]), clear: () => api('clear-completed'), options: () => optionsDialog(), scheduler: () => schedulerDialog(), queue: () => api('queue-start', state.queues[0].name), queueStop: () => api('queue-stop', state.queues[0].name), grabber: grabberDialog, browser: integrationDialog,
  export: async () => { if (await api('export')) toast('Download list exported.'); }, import: async () => { const n = await api('import'); if (n) toast(`${n} downloads imported. Select them and click Resume to start.`); }, exit: () => api('exit'),
  categories: () => { $('#sidebar').hidden = !$('#sidebar').hidden; }, details: () => {const hidden=!$('#details').hidden;localStorage.setItem('odm-details',hidden?'hidden':'visible');render();}, refresh: () => refresh(), properties: () => currentJob() && propertiesDialog(currentJob().id), progress: () => currentJob() && progressDialog(currentJob().id), open: () => currentJob() && api('open-file', currentJob().id), folder: () => currentJob() && api('show-file', currentJob().id), copy: () => currentJob() && api('copy', currentJob().url),
  about: () => showDialog('About Open Download Manager', `<div class="about-logo">${icon('browser')}<div><h2>Open Download Manager</h2><p>Version 1.2.0 · Independent implementation</p></div></div><p>Segmented downloads, recovery, queues, video extraction,<br>and browser integration for Windows and macOS.</p><p class="help-text">Inspired by Internet Download Manager's familiar workflow.<br>This app is independent and is not affiliated with Tonec or IDM.<br>Original code: MIT license. Video engine: yt-dlp and FFmpeg.</p>`),
  guide: () => showDialog('Quick guide', '<p><b>Files:</b> Click Add URL, paste a direct file address, and click Start Download.</p><p><b>Videos:</b> Add a YouTube or stream URL. Choose video quality to inspect available formats, or use the browser hover button.</p><p><b>Resume:</b> Select a stopped download and click Resume. Saved parts recover when the server supports ranges and supplies a stable validator.</p><p><b>Queues:</b> Download Later saves a stopped file. Scheduler can start all files in a queue now or enable it at a chosen time.</p><p><b>Browser:</b> Integration provides the extension folder and pairing token. Automatic capture is optional.</p><table class="shortcut-table"><tr><td>Ctrl+N</td><td>Add URL</td></tr><tr><td>Ctrl+V</td><td>Paste URL (outside text fields)</td></tr><tr><td>Ctrl+A</td><td>Select visible downloads</td></tr><tr><td>Enter</td><td>Download status</td></tr><tr><td>Delete</td><td>Remove selected downloads</td></tr><tr><td>Esc</td><td>Close a dialog or menu</td></tr></table>')
};
function runAction(name) { hideMenus(); if (actions[name]) attempt(actions[name]); }
const menuItems = {
  file: [['Add URL…', 'add', 'Ctrl+N'], ['Add batch downloads…', 'batch'], '|', ['Import download list…', 'import'], ['Export download list…', 'export'], '|', ['Exit', 'exit']],
  downloads: [['Resume selected', 'resume'], ['Pause selected', 'stop'], ['Stop all', 'stopAll'], '|', ['Start main queue', 'queue'], ['Stop main queue', 'queueStop'], ['Scheduler…', 'scheduler'], '|', ['Speed limiter…', 'limiter'], ['Options…', 'options']],
  view: [['Show/hide categories', 'categories'], ['Show/hide information', 'details'], ['Refresh', 'refresh', 'F5']],
  help: [['Browser integration…', 'browser'], ['Quick guide', 'guide', 'F1'], '|', ['About…', 'about']]
};
actions.limiter = () => optionsDialog('Connection');
actions.newCategory = () => categoryDialog();
actions.editCategory = () => categoryDialog(filter);
actions.refreshAddress = () => {
  const job = currentJob(); if (!job) return;
  if (job.status === 'complete') return toast('Add a completed file as a new download to use another address.');
  showDialog('Refresh download address', `<p>Paste a new direct address for <b>${esc(job.filename)}</b>.</p><input id="refresh-url" class="large-url" value="${esc(job.url)}"><label class="check-row"><input id="refresh-preserve" type="checkbox" checked>Keep partial data when the server confirms it is the same file</label><p class="help-text">The download will pause first. Changed validators or a different file size trigger a safe restart.</p>`, [{ text: 'Save address', primary: true, click: async () => { const url = $('#refresh-url').value.trim(), preserveParts = $('#refresh-preserve').checked; await api('pause', job.id); await api('update-job', job.id, { url, preserveParts }); closeDialog(); toast('Address refreshed. Click Resume to continue.'); } }, { text: 'Cancel', click: closeDialog }]);
};
function hideMenus() { $('#menu').hidden = true; $('#context-menu').hidden = true; }
let popupLastFocus;
function popup(target,items,x,y){
 popupLastFocus=document.activeElement;target.setAttribute('role','menu');target.innerHTML=items.map(item=>item==='|'?'<div class="menu-sep" role="separator"></div>':`<button role="menuitem" data-command="${item[1]}"><span>${esc(item[0])}</span><span class="key">${esc(item[2]||'')}</span></button>`).join('');target.hidden=false;target.style.left=`${Math.max(8,Math.min(x,innerWidth-target.offsetWidth-8))}px`;target.style.top=`${Math.max(8,Math.min(y,innerHeight-target.offsetHeight-8))}px`;target.querySelectorAll('button').forEach(button=>button.onclick=()=>runAction(button.dataset.command));
 target.onkeydown=event=>{const buttons=[...target.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1)+buttons.length)%buttons.length]?.focus();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hideMenus();popupLastFocus?.focus();}};
}
$('#toolbar').onclick = event => { const button = event.target.closest('[data-action]'); if (button) runAction(button.dataset.action); };
$('.menubar').onclick = event => { const b = event.target.closest('[data-menu]'); if (!b) return; const rect = b.getBoundingClientRect(); popup($('#menu'), menuItems[b.dataset.menu], rect.left, rect.bottom); };
$('#tree').onclick = event => { const item = event.target.closest('[data-filter]'); if (item) { filter = item.dataset.filter; render(); } };
$('#tree').oncontextmenu = event => { event.preventDefault(); const item = event.target.closest('[data-filter]'); if (!item) return; filter = item.dataset.filter; render(); popup($('#context-menu'), state.categories.some(c => c.name === filter) ? [['New category…', 'newCategory'], ['Edit category…', 'editCategory']] : [['New category…', 'newCategory']], event.clientX, event.clientY); };
$('#rows').onclick = event => { const row = event.target.closest('[data-id]'); if (!row) return; if (!event.ctrlKey && !event.metaKey) selected.clear(); if (selected.has(row.dataset.id)) selected.delete(row.dataset.id); else selected.add(row.dataset.id); render(); };
$('#rows').ondblclick = event => { const row = event.target.closest('[data-id]'); if (row) progressDialog(row.dataset.id); };
$('#rows').oncontextmenu = event => { event.preventDefault(); const row = event.target.closest('[data-id]'); if (!row) return; if (!selected.has(row.dataset.id)) selected = new Set([row.dataset.id]); render(); popup($('#context-menu'), [['Resume', 'resume'], ['Stop', 'stop'], '|', ['Open file', 'open'], ['Open containing folder', 'folder'], ['Show download status', 'progress'], ['Copy download address', 'copy'], ['Refresh download address…', 'refreshAddress'], '|', ['Properties…', 'properties'], ['Delete', 'remove', 'Del']], event.clientX, event.clientY); };
document.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => { sort.direction = sort.key === th.dataset.sort ? -sort.direction : 1; sort.key = th.dataset.sort; document.querySelectorAll('[data-sort] span').forEach(s => s.remove()); th.insertAdjacentHTML('beforeend', `<span>${sort.direction === 1 ? '▴' : '▾'}</span>`); render(); });
$('#search').oninput = event => { search = event.target.value; render(); };
$('#clear-search').onclick = () => { search = ''; $('#search').value = ''; render(); };
$('#hide-categories').onclick = actions.categories;
$('#dialog-close').onclick = closeDialog;
$('#dialog').addEventListener('cancel', () => { dialogKind = ''; detailJobId = ''; });
$('#empty-add').onclick = () => addDialog(); $('#empty-browser').onclick = () => attempt(integrationDialog); $('#connect-browser').onclick = () => attempt(integrationDialog); $('#limit-status').onclick = actions.limiter;
document.addEventListener('click', event => { if (!event.target.closest('.popup-menu,.menubar')) hideMenus(); });
document.addEventListener('keydown', event => {
  const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
  if (event.key === 'Escape') hideMenus();
  if (editing || $('#dialog').open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); addDialog(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selected = new Set(filteredJobs.map(j=>j.id)); render(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); api('read-clipboard').then(text => addDialog(text)).catch(() => addDialog()); }
  if (event.key === 'Delete') confirmDelete([...selected]);
  if (event.key === 'Enter' && currentJob()) progressDialog(currentJob().id);
  if (event.key === 'F5') { event.preventDefault(); refresh(); }
  if (event.key === 'F1') { event.preventDefault(); actions.guide(); }
});
async function refresh() { state = await api('snapshot'); render(); }
window.odm.on('state', value => { state = value; if(typeof scheduleRender==='function')scheduleRender(); });
window.odm.on('progress',jobs=>{const updates=new Map(jobs.map(j=>[j.id,j]));for(const job of state.jobs){const update=updates.get(job.id);if(update)Object.assign(job,update);}if(typeof scheduleRender==='function')scheduleRender(false);});
window.odm.on('command', command => runAction(command));
window.odm.on('browser-added', job => { toast(`Browser download added: ${job.filename}`); });
window.odm.on('clipboard-url', url => { if (!$('#dialog').open) addDialog(url); });
document.addEventListener('DOMContentLoaded',()=>attempt(async () => { await refresh(); if (state.loadWarning) toast(state.loadWarning, true); }));
setInterval(() => attempt(async () => { const integration = await api('integration'); $('#connection-dot').classList.toggle('connected', integration.connected); $('#bridge-label').textContent = integration.connected ? 'Connected to your browser' : 'Chrome & Edge extension'; }), 5000);
