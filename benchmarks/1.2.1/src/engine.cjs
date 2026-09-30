const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { request, probe, webURL, downloadURL, delay } = require('./net.cjs');
const advanced = require('./advanced.cjs');

const CATEGORIES = {
  Compressed: ['zip', '7z', 'rar', 'tar', 'gz', 'xz'],
  Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub', 'csv'],
  Music: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'],
  Programs: ['exe', 'msi', 'msix', 'iso', 'apk', 'dmg'],
  Video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ts']
};
function safeName(value) {
  let name = String(value || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 170);
  if (!name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `download_${name}`;
  return name;
}
function categoryFor(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return Object.keys(CATEGORIES).find(key => CATEGORIES[key].includes(ext)) || 'Other';
}
function filenameFrom(url, disposition = '') {
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  const normal = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
  let value = encoded?.[1] || normal?.[1] || normal?.[2] || new URL(url).pathname.split('/').pop() || 'download';
  try { value = decodeURIComponent(value); } catch {}
  return safeName(value.trim());
}
function validSegments(segments,size) {
  if(!segments.length)return true;
  const ordered=segments.slice().sort((a,b)=>a.start-b.start),indices=new Set();let next=0;
  for(const s of ordered){
    if(!Number.isSafeInteger(s.index)||s.index<0||indices.has(s.index)||!Number.isSafeInteger(s.start)||s.start!==next)return false;
    indices.add(s.index);
    if(size===null)return ordered.length===1&&s.start===0&&s.end===null;
    if(size===0)return ordered.length===1&&s.start===0&&s.end===-1;
    if(!Number.isSafeInteger(s.end)||s.end<s.start||s.end>=size)return false;
    next=s.end+1;
  }
  return next===size;
}
class Engine extends EventEmitter {
  constructor({ dataDir, downloadDir, toolsDir, ffmpegPath, nodePath, encryptSecret, decryptSecret } = {}) {
    super();
    this.dataDir = dataDir; this.tempDir = path.join(dataDir, 'parts');
    this.toolsDir = toolsDir; this.ffmpegPath = ffmpegPath; this.nodePath = nodePath || process.execPath;
    this.encryptSecret = encryptSecret; this.decryptSecret = decryptSecret; this.secretCache = new Map();
    fs.mkdirSync(this.tempDir, { recursive: true });
    this.statePath = path.join(dataDir, 'state.json');
    this.running = new Map(); this.closing = false; this.nextByteTime = 0;
    this.children = new Set(); this.captures = new Set();
    this.writingSegments = new Set();
    this.settings = { downloadDir, connections: 8, concurrent: 2, speedLimit: 0, retries: 2, categorize: true, clipboard: false, startAtLogin: false, minimizeToTray: true, proxyURL: '' };
    this.categories = [...Object.entries(CATEGORIES).map(([name, extensions]) => ({ name, extensions, directory: '' })), { name: 'Other', extensions: [], directory: '' }];
    this.jobs = []; this.queues = [{ name: 'Main download queue', enabled: true, startAt: '', stopAt: '' }];
    this.inbox = []; this.rules = []; this.subscriptions = []; this.subscriptionBusy = new Set(); this.processing = new Set();
    Object.assign(this.settings, { media: { ...advanced.DEFAULT_MEDIA }, trafficMode: 'full', uploadLimit: 128, autoExtract: false });
    this.safeName = safeName; this.filenameFrom = filenameFrom;
    this.token = crypto.randomBytes(32).toString('hex');
    const loaded = require('./state.cjs').loadState(this.statePath);
    this.validPrimary = loaded.validPrimary; this.persistenceBlocked = loaded.blocked; this.loadWarning = loaded.warning || '';
    if (loaded.state) {
      const stored = loaded.state;
      this.settings = { ...this.settings, ...stored.settings }; this.jobs = stored.jobs || [];
      this.inbox = stored.inbox || []; this.rules = stored.rules || []; this.subscriptions = stored.subscriptions || [];
      this.queues = stored.queues || this.queues; this.token = stored.token || this.token; this.categories = stored.categories || this.categories;
      if (stored.protectedSettings && decryptSecret) { try { this.settings.proxyURL = decryptSecret(stored.protectedSettings); } catch { this.settings.proxyURL = ''; this.loadWarning = 'Saved proxy credentials could not be decrypted. Configure the proxy again.'; } }
      if (stored.tokenBlob && decryptSecret) { try { this.token = decryptSecret(stored.tokenBlob); } catch { this.loadWarning = 'Saved browser pairing could not be decrypted. Pair the extension again.'; } }
      for (const job of this.jobs) {
        if (job.credentialBlob && decryptSecret) { try { const values = JSON.parse(decryptSecret(job.credentialBlob)); job.headers = values.headers || {}; job.cookies = values.cookies || []; } catch { job.headers = {}; job.cookies = []; job.error = 'Saved credentials could not be decrypted. Add this download again with fresh credentials.'; } delete job.credentialBlob; }
        job.headers ||= {}; job.cookies ||= [];
      }
    }
    for (const job of this.jobs) {
      job.headers ||= {}; job.cookies ||= [];
      if (['downloading', 'probing', 'assembling'].includes(job.status)) { job.status = 'paused'; job.speed = 0; job.error = 'Interrupted when the application closed. Resume to continue.'; }
    }
    this.timer = setInterval(() => this.tick(), 500); this.timer.unref();
    this.subscriptionTimer = setInterval(() => this.pollSubscriptions(), 30000); this.subscriptionTimer.unref();
    this.on('complete', job => { if (this.settings.autoExtract && /\.zip$/i.test(job.output)) this.archiveExtract(job.id).catch(() => {}); });
    this.save();
  }
  publicJob(job) { const { headers, cookies, credentialBlob, torrentData, ...safe } = job; return structuredClone(safe); }
  snapshot() { return { jobs: this.jobs.map(j => this.publicJob(j)), settings: this.settings, queues: this.queues, categories: this.categories, inbox: this.inbox, rules: this.rules, subscriptions: this.subscriptions, loadWarning: this.persistenceWarning || this.loadWarning || '' }; }
  save() {
    try {
    if (this.persistenceBlocked) throw Error('The unreadable history could not be preserved. Resolve its file permissions before saving.');
    const seal = (key, text) => { const old = this.secretCache.get(key); if (old?.text === text) return old.blob; const blob = this.encryptSecret(text); this.secretCache.set(key, { text, blob }); return blob; };
    const jobs = this.encryptSecret ? this.jobs.map(job => { const { headers, cookies, ...safe } = job; return { ...safe, credentialBlob: seal(job.id, JSON.stringify({ headers, cookies })) }; }) : this.jobs;
    const settings = this.encryptSecret ? { ...this.settings, proxyURL: '' } : this.settings;
    const value = JSON.stringify({ jobs, settings, inbox: this.inbox, rules: this.rules, subscriptions: this.subscriptions, queues: this.queues, categories: this.categories, token: this.encryptSecret ? '' : this.token, tokenBlob: this.encryptSecret ? seal('token', this.token) : undefined, protectedSettings: this.encryptSecret ? seal('proxy', this.settings.proxyURL) : undefined }, null, 2);
    fs.writeFileSync(this.statePath + '.tmp', value, { flush: true });
    if (this.validPrimary && fs.existsSync(this.statePath)) { fs.copyFileSync(this.statePath, this.statePath+'.bak.tmp'); fs.renameSync(this.statePath+'.bak.tmp', this.statePath+'.bak'); }
    fs.renameSync(this.statePath + '.tmp', this.statePath); this.validPrimary = true; this.persistenceWarning = ''; return true;
    }
    catch (error) { this.persistenceWarning = `Could not save download history: ${error.message}. Keep the app open until the storage problem is resolved.`; return false; }
  }
  batch(work) {
    this.ensureOpen();
    this.batchDepth = (this.batchDepth || 0) + 1;
    try { return work(); }
    finally {
      this.batchDepth--;
      if (!this.batchDepth && this.batchDirty) { this.batchDirty = false; this.changed(); this.tick(); }
    }
  }
  ensureOpen() { if (this.closing) throw Error('The application is shutting down. Reopen it before starting another operation.'); }
  changed() { if(this.closing)return; if(this.batchDepth){this.batchDirty=true;return;} clearTimeout(this.progressTimer);clearTimeout(this.checkpointTimer);this.progressTimer=null;this.checkpointTimer=null;this.save(); this.emit('change', this.snapshot()); }
  progressChanged() {
    if(this.closing)return;
    if(!this.progressTimer){this.progressTimer=setTimeout(()=>{this.progressTimer=null;const active=new Set(this.running.keys());this.emit('progress',this.jobs.filter(j=>active.has(j.id)).map(j=>this.publicJob(j)));},100);this.progressTimer.unref();}
    if(!this.checkpointTimer){this.checkpointTimer=setTimeout(()=>{this.checkpointTimer=null;this.save();},2000);this.checkpointTimer.unref();}
  }
  updateSettings(value) {
    const allowed = ['downloadDir', 'connections', 'concurrent', 'speedLimit', 'retries', 'categorize', 'clipboard', 'startAtLogin', 'minimizeToTray', 'proxyURL', 'media', 'trafficMode', 'uploadLimit', 'autoExtract'];
    const next = { ...this.settings };
    for (const key of allowed) if (key in value) next[key] = value[key];
    next.connections = Math.min(32, Math.max(1, Math.floor(Number(next.connections) || 8)));
    next.concurrent = Math.min(16, Math.max(1, Math.floor(Number(next.concurrent) || 2)));
    next.speedLimit = Math.max(0, Math.min(1048576, Number(next.speedLimit) || 0));
    next.retries = Math.min(10, Math.max(0, Math.floor(Number(next.retries) || 0)));
    next.media = advanced.mediaOptions(next.media);
    next.uploadLimit = Math.min(1048576, Math.max(1, Number(next.uploadLimit) || 128));
    if (!['full','balanced','browsing','custom'].includes(next.trafficMode)) throw Error('Unknown traffic mode.');
    if (typeof next.downloadDir !== 'string' || !path.isAbsolute(next.downloadDir)) throw new Error('Choose an absolute download folder.');
    if (next.proxyURL) { const proxy = new URL(next.proxyURL); if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:', 'socks:'].includes(proxy.protocol)) throw new Error('Use an HTTP, HTTPS, SOCKS4 or SOCKS5 proxy URL.'); }
    if (this.settings.speedLimit !== next.speedLimit) this.nextByteTime = Date.now();
    this.settings = next;
    this.changed(); this.tick(); return this.settings;
  }
  add(input) {
    this.ensureOpen();
    input = this.ruleInput(input);
    const parsedURL = downloadURL(input.url);
    let ftpAuthorization = '';
    if (parsedURL.protocol.startsWith('ftp') && (parsedURL.username || parsedURL.password)) {
      ftpAuthorization = 'Basic ' + Buffer.from(`${decodeURIComponent(parsedURL.username)}:${decodeURIComponent(parsedURL.password)}`, 'utf8').toString('base64'); parsedURL.username = ''; parsedURL.password = '';
    }
    const url = parsedURL.href;
    const filename = safeName(input.filename || filenameFrom(url));
    const type = input.type === 'file' ? 'file' : input.type === 'video' || /\.(m3u8|mpd)(?:\?|$)/i.test(url) || /(^|\.)youtube(?:-nocookie)?\.com$|(^|\.)youtu\.be$/i.test(new URL(url).hostname) ? 'video' : 'file';
    const headers = {};
    for (const [key, value] of Object.entries(input.headers || {})) if (/^(referer|cookie|authorization|user-agent|origin)$/i.test(key) && typeof value === 'string' && !/[\r\n]/.test(value)) headers[key] = value;
    if (ftpAuthorization) headers.Authorization = ftpAuthorization;
    const hostname = new URL(url).hostname;
    const cookies = Array.isArray(input.cookies) ? input.cookies.slice(0, 200).filter(c => c && typeof c.domain === 'string' && (hostname === c.domain.replace(/^\./, '') || hostname.endsWith('.' + c.domain.replace(/^\./, ''))) && typeof c.name === 'string' && typeof c.value === 'string' && !/[\r\n\t]/.test(c.name + c.value + c.domain + (c.path || '/'))).map(c => ({ domain: c.domain, name: c.name, value: c.value, path: c.path || '/', secure: !!c.secure, expiry: Number(c.expirationDate) || 0, httpOnly: !!c.httpOnly })) : [];
    if (cookies.length && type === 'file') headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const detectedCategory = type === 'video' && this.categories.some(c => c.name === 'Video') ? 'Video' : this.categories.slice().reverse().find(c => c.extensions.includes(path.extname(filename).slice(1).toLowerCase()))?.name || 'Other';
    const category = this.categories.some(c => c.name === input.category) ? input.category : detectedCategory;
    const root = input.directory || this.settings.downloadDir;
    if (!path.isAbsolute(root)) throw new Error('Download folder must be an absolute path.');
    const directory = this.settings.categorize && !input.directory ? this.categories.find(c => c.name === category)?.directory || path.join(root, category) : root;
    const queue = this.queues.some(q => q.name === input.queue) ? input.queue : this.queues[0].name;
    const job = {
      id: crypto.randomUUID(), url, headers, cookies, filename, userFilename: !!input.filename, directory, category, type,
      format: /^[\w+./<>=?,\[\]()-]{1,120}$/.test(input.format || '') ? input.format : 'bestvideo*+bestaudio/best',
      description: String(input.description || '').slice(0, 2000), queue, userCategory: !!input.category, userDirectory: !!input.directory, baseDirectory: root,
      status: input.start === false ? 'paused' : 'queued', scheduledAt: input.scheduledAt || '',
      createdAt: new Date().toISOString(), size: null, downloaded: 0, speed: 0, eta: null,
      resumable: false, segments: [], error: '', retries: 0, output: '', checksum: ''
    };
    job.package = String(input.package || '').slice(0,170);
    if (input.playlistItem) { if(!Number.isInteger(input.playlistItem)||input.playlistItem<1||input.playlistItem>1000) throw Error('Invalid collection entry index.');job.playlistItem=input.playlistItem; }
    job.media = advanced.mediaOptions(input.media || (this.settings.media.enabled ? this.settings.media : {}));
    if ((!input.format || input.format === 'bestvideo*+bestaudio/best') && (input.media || this.settings.media.enabled)) job.format = advanced.mediaFormat(job.media);
    job.mirrors = (Array.isArray(input.mirrors) ? input.mirrors.slice(0,10) : []).map(url=>webURL(url).href).filter(url=>url !== job.url);
    if (input.expectedChecksum && !/^[a-f0-9]{64}$/i.test(input.expectedChecksum)) throw Error('Expected SHA-256 must have 64 hexadecimal characters.');
    job.expectedChecksum = String(input.expectedChecksum || '').toLowerCase();
    this.jobs.push(job); this.changed(); this.tick(); return this.publicJob(job);
  }
  get(id) { const job = this.jobs.find(j => j.id === id); if (!job) throw new Error('Download no longer exists.'); return job; }
  selectedJobs(ids) {
    if (!Array.isArray(ids) || ids.length > 100000) throw Error('Invalid download selection.');
    const jobs = new Map(this.jobs.map(job => [job.id, job]));
    return [...new Set(ids)].map(id => { const job = jobs.get(id); if (!job) throw Error('Download no longer exists.'); return job; });
  }
  resumeMany(ids) {
    const jobs = this.selectedJobs(ids);
    this.batch(() => {
      let updated = false;
      for (const job of jobs) {
        if (this.running.has(job.id) || job.status === 'complete') continue;
        job.status = 'queued'; job.error = ''; job.retries = 0; job.retryAt = 0; updated = true;
      }
      if (updated) this.changed();
    });
  }
  async pauseMany(ids) {
    const jobs = this.selectedJobs(ids), pending = [];
    let updated = false;
    for (const job of jobs) {
      if (job.status === 'complete') continue;
      if (job.status !== 'paused' || job.speed) updated = true;
      job.status = 'paused'; job.speed = 0;
      const running = this.running.get(job.id);
      if (running) { running.controller.abort(); pending.push(running.promise); }
    }
    if (updated) this.changed();
    await Promise.all(pending);
  }
  async removeMany(ids) {
    const jobs = this.selectedJobs(ids), selected = new Set(jobs.map(job => job.id));
    await this.pauseMany([...selected]);
    for (let index = 0; index < jobs.length; index += 8) {
      await Promise.all(jobs.slice(index, index + 8).map(job => fsp.rm(this.jobTemp(job.id), { recursive: true, force: true })));
    }
    this.jobs = this.jobs.filter(job => !selected.has(job.id)); this.changed();
  }
  async pause(id) {
    const job = this.get(id); if (job.status === 'complete') return;
    job.status = 'paused'; job.speed = 0;
    const running = this.running.get(id); running?.controller.abort();
    if (running) await running.promise;
    this.changed();
  }
  resume(id) { this.ensureOpen(); const job = this.get(id); if (this.running.has(id) || job.status === 'complete') return; job.status = 'queued'; job.error = ''; job.retries = 0; job.retryAt = 0; this.changed(); this.tick(); }
  async remove(id) {
    await this.pause(id);
    this.jobs = this.jobs.filter(j => j.id !== id);
    await fsp.rm(this.jobTemp(id), { recursive: true, force: true }); this.changed();
  }
  async clearCompleted() { this.jobs = this.jobs.filter(j => j.status !== 'complete'); this.changed(); }
  async pauseAll() { await this.pauseMany(this.jobs.filter(job => job.status !== 'complete').map(job => job.id)); }
  jobTemp(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid download ID.'); return path.join(this.tempDir, id); }
  updateJob(id, values) {
    const job = this.get(id); if (this.running.has(id)) throw new Error('Pause this download before changing its properties.');
    if (values.url && values.url !== job.url) {
      if (job.status === 'complete') throw new Error('The address of a completed download cannot be changed. Add it as a new download.');
      const target = downloadURL(values.url), old = new URL(job.url);
      if (target.protocol + target.host !== old.protocol + old.host) { job.cookies = []; for (const key of Object.keys(job.headers)) if (/^(cookie|authorization)$/i.test(key)) delete job.headers[key]; }
      if (target.protocol.startsWith('ftp') && (target.username || target.password)) { job.headers.Authorization = 'Basic ' + Buffer.from(`${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`).toString('base64'); target.username = ''; target.password = ''; }
      job.url = target.href;
      if (!(values.preserveParts && job.type === 'file')) { job.segments = []; job.downloaded = 0; job.etag = ''; job.modified = ''; job.resetParts = true; }
      job.output = '';
    }
    if (values.filename && job.status !== 'complete') { job.filename = safeName(values.filename); job.userFilename = true; job.output = ''; }
    if (typeof values.description === 'string') job.description = values.description.slice(0, 2000);
    if (this.queues.some(q => q.name === values.queue)) job.queue = values.queue;
    if (values.scheduledAt !== undefined) job.scheduledAt = values.scheduledAt;
    this.changed();
  }
  setCategory(input) {
    const name = safeName(String(input.name || '').trim());
    if (['all', 'unfinished', 'complete', 'error'].includes(name.toLowerCase())) throw new Error('This category name is reserved.');
    if (!input.name?.trim() || name !== input.name.trim()) throw new Error('Use a category name without filename-reserved characters.');
    if (input.oldName === 'Other' && name !== 'Other') throw new Error('The Other category cannot be renamed.');
    const duplicate = this.categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.name !== input.oldName);
    if (duplicate) throw new Error('This category already exists.');
    const extensions = [...new Set(String(input.extensions || '').toLowerCase().split(/[\s,;]+/).map(e => e.replace(/^\./, '')).filter(Boolean))];
    if (extensions.some(e => !/^[a-z0-9]{1,16}$/.test(e))) throw new Error('Enter file extensions separated by spaces, such as zip 7z rar.');
    const directory = String(input.directory || '').trim(); if (directory && !path.isAbsolute(directory)) throw new Error('Choose an absolute category folder.');
    const existing = this.categories.find(c => c.name === input.oldName);
    if (existing) { existing.name = name; existing.extensions = extensions; existing.directory = directory; for (const job of this.jobs) if (job.category === input.oldName) job.category = name; }
    else { if (this.categories.length >= 50) throw new Error('Maximum 50 categories.'); this.categories.push({ name, extensions, directory }); }
    this.changed(); return name;
  }
  removeCategory(name) {
    if (name === 'Other') throw new Error('Keep the Other category as the fallback.');
    this.categories = this.categories.filter(c => c.name !== name);
    for (const job of this.jobs) if (job.category === name) job.category = 'Other';
    this.changed();
  }
  moveJob(id, direction) {
    const job = this.get(id), index = this.jobs.indexOf(job);
    const increment = direction === 'up' ? -1 : 1;
    for (let i = index + increment; i >= 0 && i < this.jobs.length; i += increment) {
      if (this.jobs[i].queue === job.queue && this.jobs[i].status !== 'complete') { [this.jobs[i], this.jobs[index]] = [this.jobs[index], this.jobs[i]]; this.changed(); break; }
    }
  }
  async startQueue(name) {
    this.batch(() => {
      this.setQueue({ name, enabled: true });
      this.resumeMany(this.jobs.filter(job => job.queue === name && ['paused', 'error'].includes(job.status)).map(job => job.id));
    });
  }
  async stopQueue(name) {
    this.setQueue({ name, enabled: false });
    await Promise.all(this.jobs.filter(j => j.queue === name && ['downloading', 'probing', 'queued', 'assembling'].includes(j.status)).map(j => this.pause(j.id)));
  }
  setQueue(input) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw Error('Use a queue name of 1 to 80 characters.');
    for (const key of ['startAt', 'stopAt']) if (key in input && (typeof input[key] !== 'string' || input[key] && !Number.isFinite(Date.parse(input[key])))) throw Error('Use a valid schedule date or leave it blank.');
    if ('concurrent' in input && !Number.isFinite(Number(input.concurrent))) throw Error('Queue concurrency must be a number.');
    input = { ...input, name: input.name.trim() };
    let queue = this.queues.find(q => q.name === input.name);
    if (!queue) { if (this.queues.length >= 20) throw new Error('Maximum 20 queues.'); queue = { name: input.name, enabled: false, startAt: '', stopAt: '' }; this.queues.push(queue); }
    for (const key of ['enabled', 'startAt', 'stopAt', 'daily']) if (key in input) queue[key] = input[key];
    if ('concurrent' in input) queue.concurrent = Math.min(16, Math.max(1, Math.floor(Number(input.concurrent) || 1)));
    this.changed(); this.tick(); return queue;
  }
  tick() {
    if (this.closing || this.batchDepth) return;
    const now = Date.now(); let updated = false;
    for (const q of this.queues) {
      const nextOccurrence = value => { if (!q.daily) return ''; const next = new Date(value); next.setDate(next.getDate()+Math.max(1,Math.floor((now-next.getTime())/86400000))); while (next.getTime() <= now) next.setDate(next.getDate()+1); return next.toISOString(); };
      if (q.startAt && now >= Date.parse(q.startAt)) { q.enabled = true; q.startAt = nextOccurrence(q.startAt); updated = true; for (const job of this.jobs) if (job.queue === q.name && ['paused', 'error'].includes(job.status)) { job.status = 'queued'; job.retries = 0; job.error = ''; } }
      if (q.stopAt && now >= Date.parse(q.stopAt)) { q.enabled = false; q.stopAt = nextOccurrence(q.stopAt); updated = true; for (const j of this.jobs.filter(j => j.queue === q.name && this.running.has(j.id))) this.pause(j.id).catch(() => {}); }
    }
    if (updated) this.changed();
    for (const job of this.jobs) {
      if (this.running.size >= this.settings.concurrent) break;
      if (job.status !== 'queued' || this.running.has(job.id) || (job.retryAt && job.retryAt > now)) continue;
      if (job.scheduledAt && Date.parse(job.scheduledAt) > now) continue;
      const queue = this.queues.find(q => q.name === job.queue);
      if (!queue?.enabled) continue;
      if (queue.concurrent && [...this.running.keys()].filter(id => this.get(id).queue === job.queue).length >= queue.concurrent) continue;
      const controller = new AbortController();
      const running = { controller, promise: null };
      this.running.set(job.id, running);
      running.promise = this.run(job, controller).catch(error => {
        if (job.status === 'complete') { job.cleanupWarning = `Download completed; a follow-up operation failed: ${error.message}`; return; }
        if ((controller.signal.aborted && !controller.failure) || job.status === 'paused') return;
        job.error = error.message; job.speed = 0; job.retries++;
        if (job.type === 'file' && job.mirrors?.length) {
          job.url = job.mirrors.shift(); job.headers = {}; job.cookies = []; job.segments = []; job.downloaded = 0; job.output = ''; job.resetParts = true;
          job.status = 'queued'; job.retryAt = Date.now() + 1000; return;
        }
        if (job.retries <= this.settings.retries) { job.status = 'queued'; job.retryAt = Date.now() + 1000 * 2 ** job.retries; }
        else job.status = 'error';
      }).finally(() => { this.running.delete(job.id); if (!this.running.size) this.nextByteTime = Date.now(); this.changed(); if (!this.closing) queueMicrotask(() => this.tick()); });
    }
  }
  async throttle(bytes, signal) {
    if (!this.settings.speedLimit) return;
    const now = Date.now(); const wait = Math.max(0, this.nextByteTime - now);
    this.nextByteTime = Math.max(now, this.nextByteTime) + bytes / (this.settings.speedLimit * 1024) * 1000;
    if (wait) await delay(wait, undefined, { signal });
  }
  progress(job, initial, started) {
    job.speed = Math.max(0, (job.downloaded - initial) / Math.max(0.1, (Date.now() - started) / 1000));
    job.eta = job.size && job.speed ? Math.max(0, (job.size - job.downloaded) / job.speed) : null;
    this.progressChanged();
  }
  uniqueOutput(job) {
    if (job.output && !fs.existsSync(job.output)) return job.output;
    const ext = path.extname(job.filename), stem = job.filename.slice(0, job.filename.length - ext.length);
    let candidate = path.join(job.directory, job.filename), index = 1;
    while (fs.existsSync(candidate) || this.jobs.some(j => j.id !== job.id && j.output === candidate)) candidate = path.join(job.directory, `${stem} (${index++})${ext}`);
    job.output = candidate; return candidate;
  }
  applyFilename(job, filename) {
    job.filename = safeName(filename);
    if (!job.userCategory) {
      const category = this.categories.slice().reverse().find(c => c.extensions.includes(path.extname(job.filename).slice(1).toLowerCase()))?.name || 'Other';
      job.category = category;
      if (!job.userDirectory && this.settings.categorize) job.directory = this.categories.find(c => c.name === category)?.directory || path.join(job.baseDirectory || this.settings.downloadDir, category);
    }
  }
  async run(job, controller) {
    const signal = controller.signal;
    job.status = 'probing'; job.error = ''; this.changed();
    await fsp.mkdir(job.directory, { recursive: true });
    await fsp.mkdir(this.jobTemp(job.id), { recursive: true });
    if (job.type === 'torrent') return require('./torrent.cjs').runTorrent(this, job, controller);
    if (/^ftps?:/i.test(job.url)) return require('./ftp.cjs').runFTP(this, job, controller);
    if (job.type === 'video') return this.runVideo(job, controller);
    const meta = await probe(job.url, job.headers, signal, this.settings.proxyURL);
    const changed = job.segments.length && (meta.size !== job.size || (job.etag && meta.etag !== job.etag) || (!job.etag && job.modified && meta.modified !== job.modified));
    const stableValidator = (meta.etag && !/^W\//i.test(meta.etag)) || meta.modified;
    if (changed || job.resetParts || !validSegments(job.segments,meta.size) || !meta.resumable || (job.segments.length && !stableValidator)) {
      await fsp.rm(this.jobTemp(job.id), { recursive: true, force: true }); await fsp.mkdir(this.jobTemp(job.id), { recursive: true }); job.segments = []; job.downloaded = 0;
      job.resetParts = false;
    }
    if (!job.userFilename) this.applyFilename(job, filenameFrom(meta.finalURL, meta.disposition));
    await fsp.mkdir(job.directory, { recursive: true });
    job.size = meta.size; job.resumable = meta.resumable; job.etag = meta.etag; job.modified = meta.modified;
    if (!job.segments.length) {
      job.segments = [{ index: 0, start: 0, end: meta.size === null ? null : meta.size - 1, done: 0 }];
    }
    for (const segment of job.segments) {
      try { segment.done = (await fsp.stat(path.join(this.jobTemp(job.id), `${segment.index}.part`))).size; } catch { segment.done = 0; }
      if (segment.end !== null && segment.done > segment.end - segment.start + 1) throw new Error('Saved partial segment has an invalid length.');
    }
    job.downloaded = job.segments.reduce((sum, s) => sum + s.done, 0); job.status = 'downloading'; this.changed();
    const initial = job.downloaded, started = Date.now();
    const timer = setInterval(() => this.progress(job, initial, started), 500);
    try {
      const results = await this.segmentPool(job, controller);
      if (controller.failure) throw controller.failure;
      const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
      signal.throwIfAborted();
      job.status = 'assembling'; this.changed();
      const staging = path.join(this.jobTemp(job.id), 'assembled.tmp');
      const handle = await fsp.open(staging, 'w'); const hash = crypto.createHash('sha256'); let total = 0;
      try {
        for (const segment of job.segments.slice().sort((a, b) => a.start - b.start)) {
          const part = path.join(this.jobTemp(job.id), `${segment.index}.part`);
          if (!fs.existsSync(part) && job.size === 0) continue;
          for await (const chunk of fs.createReadStream(part)) {
            signal.throwIfAborted(); let written = 0;
            while (written < chunk.length) { const result = await handle.write(chunk, written, chunk.length - written); if (!result.bytesWritten) throw new Error('Disk write failed during assembly.'); written += result.bytesWritten; }
            hash.update(chunk); total += chunk.length;
          }
        }
      } finally { await handle.close(); }
      if ((job.size !== null && total !== job.size) || (await fsp.stat(staging)).size !== total) throw new Error(`Integrity check failed: expected ${job.size} bytes, received ${total}.`);
      const checksum = hash.digest('hex');
      if (job.expectedChecksum && checksum !== job.expectedChecksum) throw Error('SHA-256 verification failed. The downloaded file does not match the expected checksum.');
      await require('./publication.cjs').publishFile(this,job,staging,signal);
      job.checksum = checksum; job.downloaded = total; job.size = total; job.status = 'complete'; job.completedAt = new Date().toISOString(); job.error = ''; job.speed = 0; job.eta = 0;
      await require('./publication.cjs').cleanupTemp(this,job);
      this.emit('complete', this.publicJob(job));
    } finally { clearInterval(timer); }
  }
  async segmentPool(job, controller) {
    const active = new Set(), assigned = new Set();
    const acquire = () => {
      let segment = job.segments.find(s => !assigned.has(s) && (s.end === null || s.done < s.end - s.start + 1));
      if (!segment && job.resumable && job.segments.length < 256) {
        // Reuse a finished worker to split the largest unfinished range in half.
        const candidates = [...active].filter(s => !this.writingSegments.has(s) && s.end - s.start + 1 - s.done > 512 * 1024);
        const largest = candidates.sort((a, b) => (b.end - b.start - b.done) - (a.end - a.start - a.done))[0];
        if (largest) {
          const boundary = Math.floor((largest.start + largest.done + largest.end + 1) / 2);
          segment = { index: Math.max(...job.segments.map(s => s.index)) + 1, start: boundary, end: largest.end, done: 0 };
          largest.end = boundary - 1; job.segments.push(segment); this.changed();
        }
      }
      if (segment) { assigned.add(segment); active.add(segment); }
      return segment;
    };
    const count = job.resumable ? this.settings.connections : 1;
    return Promise.allSettled(Array.from({ length: count }, async () => {
      let segment;
      while (!controller.signal.aborted && (segment = acquire())) {
        try { await this.transfer(job, segment, controller.signal); }
        catch (error) { if (!controller.signal.aborted) { controller.failure = error; controller.abort(); } throw error; }
        finally { active.delete(segment); }
      }
    }));
  }
  async transfer(job, segment, signal) {
    const expectedLength = () => segment.end === null ? null : Math.max(0, segment.end - segment.start + 1);
    if (expectedLength() !== null && segment.done === expectedLength()) return;
    const start = segment.start + segment.done;
    const requestedEnd = segment.end;
    const headers = { ...job.headers };
    if (job.resumable) {
      headers.Range = `bytes=${start}-${requestedEnd}`;
      if (job.etag && !job.etag.startsWith('W/')) headers['If-Range'] = job.etag;
      else if (job.modified) headers['If-Range'] = job.modified;
    }
    const res = await request(job.url, { headers, signal, proxy: this.settings.proxyURL });
    if (job.resumable) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers['content-range'] || '');
      if (res.statusCode !== 206 || !range || +range[1] !== start || +range[2] !== requestedEnd || +range[3] !== job.size) { res.destroy(); throw new Error('Server returned an invalid byte range. Download stopped to prevent corruption.'); }
      if (job.etag && res.headers.etag && job.etag !== res.headers.etag) { res.destroy(); throw new Error('Remote file changed during download. Resume to restart safely.'); }
      if (job.modified && res.headers['last-modified'] && job.modified !== res.headers['last-modified']) { res.destroy(); throw new Error('Remote file changed during download. Resume to restart safely.'); }
    } else if (res.statusCode !== 200) { res.destroy(); throw new Error(`Server returned HTTP ${res.statusCode}.`); }
    let handle;
    try {
      handle = await fsp.open(path.join(this.jobTemp(job.id), `${segment.index}.part`), 'a');
      for await (let chunk of res) {
        signal.throwIfAborted();
        const expected = expectedLength();
        if (expected !== null && segment.done + chunk.length > expected) {
          if (requestedEnd === segment.end) { res.destroy(); throw new Error('Server sent too many bytes.'); }
          chunk = chunk.subarray(0, expected - segment.done);
        }
        this.writingSegments.add(segment);
        try {
          await this.throttle(chunk.length, signal);
          let offset = 0;
          while (offset < chunk.length) { const result = await handle.write(chunk, offset, chunk.length - offset); if (!result.bytesWritten) throw new Error('Disk write failed.'); offset += result.bytesWritten; }
          segment.done += chunk.length; job.downloaded += chunk.length;
        } finally { this.writingSegments.delete(segment); }
        if (requestedEnd !== segment.end && expectedLength() !== null && segment.done === expectedLength()) break;
      }
      if (expectedLength() !== null && segment.done !== expectedLength()) throw new Error('Connection ended before the file was complete.');
    } finally { res.destroy(); await handle?.close(); }
  }
  ytdlp() { const exe = path.join(this.toolsDir || '', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'); if (!fs.existsSync(exe)) throw new Error('Video engine is missing. Run tools/setup.ps1.'); return exe; }
  videoArgs() {
    const args = ['--ignore-config', '--no-playlist', '--no-warnings', '--js-runtimes', `node:${this.nodePath}`];
    if (this.ffmpegPath) args.push('--ffmpeg-location', this.ffmpegPath);
    if (this.settings.proxyURL) args.push('--proxy', this.settings.proxyURL);
    return args;
  }
  async inspectVideo(url,signal) {
    webURL(url);
    const args = [...this.videoArgs(), '--dump-single-json', '--skip-download', '--', url];
    const info = await this.capture(this.ytdlp(), args, 90000,signal);
    const data = JSON.parse(info);
    return { title: data.title, duration: data.duration, thumbnail: data.thumbnail, formats: (data.formats || []).filter(f => f.vcodec !== 'none' || f.acodec !== 'none').map(f => ({ id: f.format_id, ext: f.ext, height: f.height, width: f.width, note: f.format_note, size: f.filesize || f.filesize_approx, audio: f.acodec !== 'none', video: f.vcodec !== 'none' })) };
  }
  capture(exe, args, timeout,signal) {
    if(this.closing)return Promise.reject(new Error('The application is shutting down.'));
    const result = new Promise((resolve, reject) => {
      if(signal?.aborted){reject(new Error('Inspection cancelled.'));return;}
      const child = spawn(exe, args, { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      const abort=()=>this.killProcess(child);signal?.addEventListener('abort',abort,{once:true});
      this.children.add(child);
      let stdout = '', stderr = '', bytes=0, failure;
      const timer = setTimeout(() => { failure ||= new Error('Media or archive operation timed out.'); this.killProcess(child); }, timeout);
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { if(failure)return;bytes+=Buffer.byteLength(chunk);if(bytes>16*1024*1024){failure=new Error('Inspection output exceeds the 16 MB limit.');this.killProcess(child);}else stdout+=chunk; });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
      child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort',abort);this.children.delete(child); reject(error); });
      child.on('close', code => { clearTimeout(timer);signal?.removeEventListener('abort',abort); this.children.delete(child); if(signal?.aborted)reject(new Error('Inspection cancelled.'));else if(failure)reject(failure);else if (code === 0) resolve(stdout); else reject(new Error(stderr.trim() || 'Media or archive operation failed.')); });
    });
    this.captures.add(result); return result.finally(()=>this.captures.delete(result));
  }
  killProcess(child) {
    if (!child.pid || child._odmStopping || child.exitCode!==null || child.signalCode!==null) return;
    child._odmStopping=true;
    const fallback=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1500);fallback.unref();child.once('close',()=>clearTimeout(fallback));
    if (process.platform === 'win32') { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); killer.on('error', () => child.kill('SIGKILL'));killer.on('exit',code=>{if(code!==0)child.kill('SIGKILL');}); }
    else child.kill('SIGTERM');
  }
  async runVideo(job, controller) {
    if (job.resetParts) { await fsp.rm(this.jobTemp(job.id), { recursive: true, force: true }); await fsp.mkdir(this.jobTemp(job.id), { recursive: true }); job.resetParts = false; }
    const args = [...this.videoArgs().filter(x=>!job.playlistItem || x!=='--no-playlist'), ...(job.playlistItem ? ['--yes-playlist'] : []), '--playlist-items', String(job.playlistItem || 1), '--newline', '--continue', '--no-overwrites', '--progress-template', 'download:ODM_PROGRESS:%(progress.downloaded_bytes)s:%(progress.total_bytes,progress.total_bytes_estimate)s:%(progress.speed)s:%(progress.eta)s', '--print', 'after_move:ODM_FILE:%(filepath)s', '-f', job.format,
      '-o', path.join(this.jobTemp(job.id), 'video.%(ext)s'), '--merge-output-format', 'mp4/mkv', '--print', 'before_dl:ODM_TITLE:%(title)s'];
    const media = advanced.mediaOptions(job.media || {});
    args.push(...advanced.mediaArgs(media));
    if (job.format === 'bestaudio/best') args.push('--extract-audio', '--audio-format', media.audioFormat);
    if (this.settings.speedLimit) args.push('--limit-rate', `${Math.floor(this.settings.speedLimit / Math.max(1, this.running.size))}K`);
    if (job.cookies?.length) {
      const cookieFile = path.join(this.jobTemp(job.id), 'cookies.txt');
      const rows = job.cookies.map(c => `${c.httpOnly ? '#HttpOnly_' : ''}${c.domain}\t${c.domain.startsWith('.') ? 'TRUE' : 'FALSE'}\t${c.path}\t${c.secure ? 'TRUE' : 'FALSE'}\t${Math.floor(c.expiry)}\t${c.name}\t${c.value}`);
      await fsp.writeFile(cookieFile, '# Netscape HTTP Cookie File\n' + rows.join('\n') + '\n'); args.push('--cookies', cookieFile);
    }
    for (const [key, value] of Object.entries(job.headers)) if (!(job.cookies?.length && /^cookie$/i.test(key))) args.push('--add-header', `${key}:${value}`);
    args.push('--', job.url);
    job.status = 'downloading'; job.resumable = true; this.changed();
    let videoTitle = '';
    const file = await new Promise((resolve, reject) => {
      const child = spawn(this.ytdlp(), args, { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      this.children.add(child);child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      let buffer = '', stderr = '', output = '', failure;
      const stop = () => this.killProcess(child); controller.signal.addEventListener('abort', stop, { once: true });
      if (controller.signal.aborted) stop();
      const parseLine = line => {
          if (line.startsWith('ODM_FILE:')) output = line.slice(9).trim();
          if (line.startsWith('ODM_TITLE:')) videoTitle = line.slice(10).trim();
          if (line.startsWith('ODM_PROGRESS:')) {
            const [, done, size, speed, eta] = line.split(':');
            const number=value=>Number.isFinite(Number(value))&&Number(value)>=0?Number(value):0;
            job.downloaded = number(done); job.size = number(size) || null; job.speed = number(speed); job.eta = number(eta) || null; this.progressChanged();
          }
      };
      child.stdout.on('data', chunk => {if(failure)return;buffer+=chunk;if(buffer.length>1024*1024){failure=new Error('Video engine returned an oversized output line.');buffer='';stop();return;}const lines=buffer.split(/\r?\n/);buffer=lines.pop();for(const line of lines)parseLine(line);});
      child.stdout.on('end',()=>{if(buffer)parseLine(buffer);buffer='';});
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-5000); });
      child.on('error',error=>{this.children.delete(child);controller.signal.removeEventListener('abort',stop);reject(error);});
      child.on('close', code => { this.children.delete(child);controller.signal.removeEventListener('abort', stop); if(failure)reject(failure);else if (code === 0 && output) resolve(output); else reject(new Error(stderr.trim() || 'Video download was interrupted.')); });
    });
    controller.signal.throwIfAborted();
    const resolved = path.resolve(file), base = path.resolve(this.jobTemp(job.id)) + path.sep;
    if (!resolved.startsWith(base)) throw new Error('Video engine returned an invalid output path.');
    if (!job.userFilename || /^(watch|download)$/.test(job.filename)) {
      job.filename = safeName((videoTitle || 'video') + path.extname(file));
    } else if (path.extname(job.filename).toLowerCase() !== path.extname(file).toLowerCase()) job.filename = safeName(job.filename.replace(/\.[a-z0-9]{2,5}$/i, '') + path.extname(file));
    this.applyFilename(job, job.filename); await fsp.mkdir(job.directory, { recursive: true });
    job.status = 'assembling'; this.changed();
    const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) { controller.signal.throwIfAborted(); hash.update(chunk); }
    const checksum=hash.digest('hex');if(job.expectedChecksum && checksum!==job.expectedChecksum)throw Error('SHA-256 verification failed. The downloaded file does not match the expected checksum.');
    const output = await require('./publication.cjs').publishFile(this,job,file,controller.signal);
    job.sidecars = [];
    for (const name of await fsp.readdir(this.jobTemp(job.id))) {
      if (!/^video\.(?:[a-zA-Z0-9_-]+\.)?(srt|vtt|jpg|jpeg|png|webp)$/i.test(name)) continue;
      const sidecar = output.slice(0,-path.extname(output).length) + name.slice(5);
      await fsp.copyFile(path.join(this.jobTemp(job.id),name),sidecar,fs.constants.COPYFILE_EXCL); job.sidecars.push(sidecar);
    }
    job.size = (await fsp.stat(output)).size; job.downloaded = job.size; job.status = 'complete'; job.speed = 0; job.eta = 0; job.completedAt = new Date().toISOString();
    job.checksum = checksum;
    await require('./publication.cjs').cleanupTemp(this,job); this.emit('complete', this.publicJob(job));
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true; clearTimeout(this.progressTimer); clearTimeout(this.checkpointTimer); clearInterval(this.timer); clearInterval(this.subscriptionTimer);
    for (const child of this.children) this.killProcess(child);
    this.closePromise = (async () => { await this.pauseAll(); await Promise.allSettled([...this.captures]); await Promise.allSettled([...this.running.values()].map(r => r.promise)); this.save(); this.secretCache.clear(); })();
    return this.closePromise;
  }
}
advanced.install(Engine);
require('./torrent.cjs').install(Engine);
module.exports = { Engine, safeName, filenameFrom, categoryFor, CATEGORIES };
