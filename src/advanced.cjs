const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { request, probe, webURL, downloadURL } = require('./net.cjs');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { crc32 } = require('node:zlib');

const DEFAULT_MEDIA = { enabled: false, quality: 'best', container: 'auto', audioFormat: 'mp3', subtitles: '', autoSubtitles: false, metadata: false, thumbnail: false };
function mediaOptions(value = {}) {
  const v = { ...DEFAULT_MEDIA, ...value };
  if (!['best', '4320', '2160', '1080', '720', '480', 'audio'].includes(v.quality)) throw Error('Choose a supported media quality.');
  if (!['auto', 'mp4', 'mkv'].includes(v.container)) throw Error('Choose Auto, MP4 or MKV.');
  if (!['mp3', 'm4a', 'opus', 'flac', 'wav'].includes(v.audioFormat)) throw Error('Unsupported audio format.');
  if (!/^[a-zA-Z0-9,.*_-]{0,80}$/.test(v.subtitles)) throw Error('Use subtitle language codes, such as en,ur or en.*.');
  for (const key of ['enabled', 'autoSubtitles', 'metadata', 'thumbnail']) v[key] = !!v[key];
  return Object.fromEntries(Object.keys(DEFAULT_MEDIA).map(k => [k, v[k]]));
}
function mediaArgs(v) {
  v = mediaOptions(v); const args = [];
  if (v.container !== 'auto' && v.quality !== 'audio') args.push('--remux-video', v.container);
  if (v.subtitles) { args.push('--write-subs', '--sub-langs', v.subtitles, '--convert-subs', 'srt'); if (v.autoSubtitles) args.push('--write-auto-subs'); }
  if (v.metadata) args.push('--embed-metadata', '--embed-chapters');
  if (v.thumbnail) args.push('--write-thumbnail');
  return args;
}
function mediaFormat(v) { return v.quality === 'audio' ? 'bestaudio/best' : v.quality === 'best' ? 'bestvideo*+bestaudio/best' : `bestvideo[height<=${v.quality}]+bestaudio/best[height<=${v.quality}]`; }
function extractURLs(text) {
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw Error('Paste up to 1 MB of text.');
  const urls = new Set();
  for (const match of text.matchAll(/(?:https?|ftps?):\/\/[^\s<>"']+|magnet:\?[^\s<>"']+/gi)) {
    try { const u = match[0].replace(/&amp;/g, '&').replace(/[),.;]+$/, ''); urls.add(u.startsWith('magnet:') ? validMagnet(u) : downloadURL(u).href); } catch {}
    if (urls.size > 1000) throw Error('Collect up to 1,000 links at once.');
  }
  return [...urls];
}
function validMagnet(url) { const u = new URL(url); if (u.protocol !== 'magnet:' || !u.searchParams.getAll('xt').some(x=>/^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(x))) throw Error('Enter a BitTorrent v1 magnet link.'); return u.href; }
function safeRelative(value) {
  const p = String(value).replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /[\x00-\x1f:]/.test(p) || p.split('/').some(s => s === '..' || s === '.' || /[. ]$/.test(s) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s))) throw Error('Archive or torrent contains an unsafe path.');
  return p;
}
async function zipInventory(file, fn) {
  const yauzl = require('yauzl');
  const zip = await new Promise((resolve, reject) => {
    const options={ lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true };
    const done=(err,z)=>err?reject(err):resolve(z);
    if(typeof file==='object')yauzl.fromRandomAccessReader(file.reader,file.size,options,done);else yauzl.open(file,options,done);
  });
  try {
    const entries = []; let total = 0;
    await new Promise((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', entry => {
        try {
          safeRelative(entry.fileName.replace(/\/$/, ''));
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode && ![0x8000, 0x4000].includes(mode)) throw Error('Archive links and special files are not extracted.');
          total += entry.uncompressedSize;
          if (entries.length >= 10000 || total > 20 * 1024 ** 3) throw Error('Archive exceeds 10,000 entries or 20 GB uncompressed.');
          if (entry.generalPurposeBitFlag & 1) throw Error('Encrypted ZIP files are not supported.');
          entries.push(entry); zip.readEntry();
        } catch (err) { reject(err); }
      }); zip.readEntry();
    });
    return await fn(zip, entries);
  } finally { zip.close(); }
}
async function listZIP(file) { return zipInventory(file, (_, entries) => entries.filter(e=>!e.fileName.endsWith('/')).map(e=>({ name:e.fileName, size:e.uncompressedSize, compressed:e.compressedSize }))); }
async function extractZIP(file, destination, selected) {
  return zipInventory(file, async (zip, entries) => {
    const names = selected ? new Set(selected) : null;
    if (names && [...names].some(n=>!entries.some(e=>e.fileName === n))) throw Error('An archive selection no longer exists.');
    await fsp.mkdir(destination, { recursive: false });
    const output = [];
    try {
      for (const entry of entries) {
        if (entry.fileName.endsWith('/') || names && !names.has(entry.fileName)) continue;
        const target = path.join(destination, safeRelative(entry.fileName));
        await fsp.mkdir(path.dirname(target), { recursive:true });
        const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (err, s)=>err ? reject(err):resolve(s)));
        let crc=0;const verify=new Transform({transform(chunk,encoding,callback){crc=crc32(chunk,crc);callback(null,chunk);},flush(callback){callback(crc===entry.crc32?null:Error('ZIP file CRC verification failed.'));}});
        await pipeline(stream, verify, fs.createWriteStream(target, { flags:'wx' })); output.push(target);
      }
      return output;
    } catch (err) { err.message += ` Partial extraction remains at ${destination}.`; throw err; }
  });
}
function install(Engine) {
  Object.assign(Engine.prototype, {
    collect(text, packageName = '') {
      const urls = extractURLs(text), existing = new Set([...this.inbox.map(i=>i.url), ...this.jobs.map(j=>j.url)]);
      const name = this.safeName(packageName || 'Collected links'); let added = 0;
      for (const url of urls) if (!existing.has(url)) { existing.add(url); this.inbox.push({ id:crypto.randomUUID(), url, filename:url.startsWith('magnet:') ? new URL(url).searchParams.get('dn') || 'Torrent' : this.filenameFrom(url), package:name, availability:'unchecked', size:null }); added++; }
      this.changed(); return { added, duplicates:urls.length - added };
    },
    async checkLinks(ids) {
      const items = this.inbox.filter(i=>ids.includes(i.id)); let index=0;
      await Promise.all(Array.from({length:Math.min(4,items.length)}, async()=>{
        while (index<items.length) {
          const i=items[index++];
          if (!/^https?:/.test(i.url)) { i.availability='not checked'; continue; }
          try { const meta = await probe(i.url, {}, AbortSignal.timeout(15000), this.settings.proxyURL); i.availability='online'; i.size=meta.size; i.filename=this.filenameFrom(i.url, meta.disposition); }
          catch(err) { i.availability='unavailable'; i.error=err.message; }
        }
      })); this.changed(); return items;
    },
    removeLinks(ids) { this.inbox=this.inbox.filter(i=>!ids.includes(i.id)); this.changed(); },
    startLinks(ids, options={}) {
      const items=this.inbox.filter(i=>ids.includes(i.id));
      // Validate the whole batch before moving anything out of the collector.
      if (options.directory && !path.isAbsolute(options.directory)) throw Error('Choose an absolute package folder.');
      const result=[];
      for (const i of items) {
        const directory=options.directory || (options.packageFolders ? path.join(this.settings.downloadDir,this.safeName(i.package)) : '');
        if (i.url.startsWith('magnet:')) result.push(this.addTorrent({url:i.url,directory,queue:options.queue,start:options.start}));
        else result.push(this.add({url:i.url,filename:i.filename,package:i.package,directory,queue:options.queue,start:options.start,type:options.video?'video':undefined}));
      }
      this.removeLinks(items.map(i=>i.id)); return result;
    },
    setRules(rules) {
      if (!Array.isArray(rules) || rules.length>50) throw Error('Use up to 50 organization rules.');
      const validated=rules.map(r=>{
        const host=String(r.host || '').trim().toLowerCase(), extensions=String(r.extensions || '').toLowerCase().split(/[\s,;]+/).map(x=>x.replace(/^\./,'')).filter(Boolean);
        if (host && !/^(?:\*\.)?[a-z0-9.-]+$/.test(host)) throw Error('Host must be a domain or *.domain wildcard.');
        if (extensions.some(e=>!/^[a-z0-9]{1,16}$/.test(e))) throw Error('Use file extensions separated by spaces.');
        if (r.directory && !path.isAbsolute(r.directory)) throw Error('Rule folder must be absolute.');
        return { host,extensions,category:this.categories.some(c=>c.name===r.category)?r.category:'',package:r.package?this.safeName(r.package):'',directory:r.directory || '',enabled:r.enabled!==false };
      }); this.rules=validated; this.changed(); return validated;
    },
    ruleInput(input) {
      const hostname=new URL(input.url).hostname.toLowerCase(), ext=path.extname(input.filename || new URL(input.url).pathname).slice(1).toLowerCase();
      const rule=this.rules.find(r=>r.enabled && (!r.host || r.host.startsWith('*.') ? !r.host || hostname===r.host.slice(2) || hostname.endsWith(r.host.slice(1)) : hostname===r.host) && (!r.extensions.length || r.extensions.includes(ext)));
      if (!rule) return input;
      const result={...input}; for(const key of ['category','directory','package']) if(!result[key] && rule[key]) result[key]=rule[key];
      return result;
    },
    async inspectCollection(url, limit=200,signal) {
      webURL(url); limit=Math.min(10000,Math.max(1,Number(limit)||200));
      const args=this.videoArgs(url).filter(x=>x!=='--no-playlist');
      args.push('--yes-playlist','--flat-playlist','--playlist-end',String(limit),'--dump-single-json','--skip-download','--',url);
      const data=JSON.parse(await this.withVideoCookies(url,args,signal,()=>this.capture(this.ytdlp(),args,120000+limit*50,signal,32*1024*1024)));
      const entries=(data.entries || [data]).filter(Boolean).map((e,index)=>{
        const target=e.webpage_url || (/^https?:/.test(e.url || '')?e.url:/youtube/i.test(e.ie_key || data.extractor || '')?`https://www.youtube.com/watch?v=${e.id}`:'');
        try { webURL(target); return {id:String(e.id || target),url:target,title:e.title || e.id || 'Video',duration:e.duration || null,index:index+1,...(data.entries && target===url ? {playlistItem:index+1}: {})}; } catch{return null;}
      }).filter(Boolean);
      return {title:data.title || 'Media collection',entries,limit,truncated:entries.length>=limit};
    },
    addCollection(input) {
      if(!Array.isArray(input.entries) || !input.entries.length || input.entries.length>10000) throw Error('Select 1 to 10,000 media entries.');
      const key=e=>e.url+'|'+(e.playlistItem||'');
      const urls=new Set(this.jobs.filter(j=>j.type==='video'&&(!input.playlistId||j.playlistId===input.playlistId)).map(key)), result=[];
      for(const e of input.entries) webURL(e.url);
      const directory=input.directory || path.join(this.settings.downloadDir,this.safeName(input.title || 'Media collection'));
      if(!path.isAbsolute(directory)) throw Error('Choose an absolute collection folder.');
      for(const e of input.entries) if(!urls.has(key(e))){ urls.add(key(e)); result.push(this.add({url:e.url,playlistItem:e.playlistItem,filename:`${String(e.index || result.length+1).padStart(3,'0')} - ${e.title || 'video'}`,package:input.title,type:'video',directory,queue:input.queue,start:input.start!==false,media:input.media,batchId:input.batchId,playlistId:input.playlistId,cloudProfileId:input.cloudProfileId,deleteLocal:input.deleteLocal})); }
      return {added:result.length,duplicates:input.entries.length-result.length,jobs:result};
    },
    setSubscription(input) {
      let sub=this.subscriptions.find(s=>s.id===input.id);
      if(input.remove){this.subscriptions=this.subscriptions.filter(s=>s.id!==input.id);this.changed();return;}
      if(!sub){if(this.subscriptions.length>=50) throw Error('Maximum 50 subscriptions.');webURL(input.url);sub={id:crypto.randomUUID(),url:input.url,name:String(input.name || 'Media subscription').slice(0,150),seen:[],lastCheck:0,nextCheck:0,error:''};}
      const directory=input.directory || sub.directory || path.join(this.settings.downloadDir,this.safeName(sub.name));if(!path.isAbsolute(directory))throw Error('Choose an absolute subscription folder.');const media=mediaOptions(input.media || this.settings.media);if(!this.subscriptions.includes(sub))this.subscriptions.push(sub);sub.enabled=input.enabled!==false;sub.interval=Math.min(10080,Math.max(15,Number(input.interval)||60));sub.directory=input.directory || sub.directory || path.join(this.settings.downloadDir,this.safeName(sub.name));
      if(!path.isAbsolute(sub.directory)) throw Error('Choose an absolute subscription folder.');
      sub.media=media;sub.nextCheck=0;this.changed();return sub;
    },
    async checkSubscription(id) {
      const sub=this.subscriptions.find(s=>s.id===id);if(!sub) throw Error('Subscription no longer exists.');
      if(this.subscriptionBusy.has(id)) throw Error('This subscription is already checking.');
      this.subscriptionBusy.add(id); let added=0;
      try {
        const collection=await this.inspectCollection(sub.url,200);if(!this.subscriptions.includes(sub)) return {added:0};
        const fresh=collection.entries.filter(e=>!sub.seen.includes(e.id));
        if(fresh.length) added=this.addCollection({entries:fresh,title:sub.name,directory:sub.directory,media:sub.media}).added;
        sub.seen=[...new Set([...sub.seen,...collection.entries.map(e=>e.id)])].slice(-20000);sub.error='';
      } catch(err){sub.error=err.message;throw err;}
      finally {sub.lastCheck=Date.now();sub.nextCheck=Date.now()+sub.interval*60000;this.subscriptionBusy.delete(id);this.changed();}
      return {added};
    },
    pollSubscriptions() {
      if(this.closing) return;
      for(const sub of this.subscriptions) if(sub.enabled && sub.nextCheck<=Date.now() && !this.subscriptionBusy.size){this.checkSubscription(sub.id).catch(()=>{});break;}
    },
    setTraffic(mode, custom=0) {
      const limits={full:0,balanced:2048,browsing:256,custom:Math.max(1,Math.min(1048576,Number(custom)||1024))};
      if(!(mode in limits)) throw Error('Unknown traffic mode.');
      return this.updateSettings({trafficMode:mode,speedLimit:limits[mode]});
    },
    async archiveList(id,password='') {const j=this.get(id);if(j.status!=='complete'||!/\.(zip|7z|rar|tar|gz|xz)$/i.test(j.output)) throw Error('Select a completed archive.');return /\.zip$/i.test(j.output) && !password ? listZIP(j.output) : require('./archive.cjs').listArchive(this,j.output,password);},
    async archiveExtract(id, selected, password='') {
      const j=this.get(id);if(j.status!=='complete'||!/\.(zip|7z|rar|tar|gz|xz)$/i.test(j.output)) throw Error('Select a completed archive.');
      if(this.processing.has(id)) throw Error('This file is already being processed.');this.processing.add(id);j.postProcess='Extracting ZIP…';this.changed();
      const stem=j.output.slice(0,-path.extname(j.output).length);let destination=stem+' - extracted',n=1;while(fs.existsSync(destination))destination=stem+` - extracted (${n++})`;
      try{const files=/\.zip$/i.test(j.output) && !password ? await extractZIP(j.output,destination,selected) : await require('./archive.cjs').extractArchive(this,j.output,destination,selected,password);j.extractedTo=destination;j.postProcess=`Extracted ${files.length} files`;return {destination,files};}
      catch(err){j.postProcess='Extraction failed: '+err.message;throw err;}finally{this.processing.delete(id);this.changed();}
    },
    async convertMedia(id, format) {
      const j=this.get(id);if(j.status!=='complete'||!fs.existsSync(j.output)||!/\.(mp4|mkv|webm|mov|avi|mp3|wav|m4a|flac|opus|ogg)$/i.test(j.output)) throw Error('Select a completed audio or video file.');
      const codecs={mp4:['-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac','-movflags','+faststart'],mp3:['-vn','-c:a','libmp3lame','-q:a','2'],m4a:['-vn','-c:a','aac','-b:a','192k'],flac:['-vn','-c:a','flac']};
      if(!codecs[format]) throw Error('Unsupported conversion format.');if(this.processing.has(id)) throw Error('This file is already being processed.');this.processing.add(id);j.postProcess='Converting to '+format.toUpperCase();this.changed();
      const filename=path.basename(j.output,path.extname(j.output))+' - converted.'+format;
      const staging=path.join(this.tempDir,'conversion-'+crypto.randomUUID()+'.'+format);
      try{await this.capture(this.ffmpegPath,['-hide_banner','-nostdin','-n','-i',j.output,...codecs[format],staging],30*60000);const output=await require('./publication.cjs').publishFile(this,{filename,directory:path.dirname(j.output),output:''},staging);j.convertedOutputs ||= [];j.convertedOutputs.push(output);j.postProcess='Conversion complete';return output;}
      catch(err){j.postProcess='Conversion failed: '+err.message;throw err;}finally{await fsp.rm(staging,{force:true}).catch(()=>{});this.processing.delete(id);this.changed();}
    },
    async crawl(input) {
      const root=webURL(input.url), maxPages=Math.min(50,Math.max(1,Number(input.pages)||10)), maxDepth=Math.min(3,Math.max(0,Number(input.depth)||0));
      const exts=String(input.extensions || 'zip 7z rar pdf mp4 mp3 jpg png').toLowerCase().split(/[\s,;]+/).filter(Boolean);if(exts.some(e=>!/^[a-z0-9]{1,16}$/.test(e))) throw Error('Use plain file extensions.');
      const todo=[{url:root.href,depth:0}],seen=new Set(),links=new Map(),errors=[];
      while(todo.length && seen.size<maxPages && links.size<1000){
        const item=todo.shift();if(seen.has(item.url))continue;seen.add(item.url);
        try{
          const res=await request(item.url,{signal:AbortSignal.timeout(15000),proxy:this.settings.proxyURL});
          if(new URL(res.finalURL).origin!==root.origin || res.statusCode>=400 || !/text\/html/i.test(res.headers['content-type'] || 'text/html')){res.destroy();continue;}
          let size=0,chunks=[];for await(const c of res){size+=c.length;if(size>4*1024**2){res.destroy();throw Error('Page exceeds 4 MB.');}chunks.push(c);}
          const html=Buffer.concat(chunks).toString('utf8');
          for(const m of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)){
            try{const u=webURL(new URL(m[1].replace(/&amp;/g,'&'),res.finalURL).href);u.hash='';const ext=path.extname(u.pathname).slice(1).toLowerCase();
              if(exts.includes(ext))links.set(u.href,{url:u.href,filename:this.filenameFrom(u.href)});
              else if(u.origin===root.origin && item.depth<maxDepth && (!ext || /^(html?|php|asp|aspx)$/.test(ext)) && todo.length<500)todo.push({url:u.href,depth:item.depth+1});
            }catch{}if(links.size>=1000)break;
          }
        }catch(err){errors.push({url:item.url,error:err.message});}
      }
      return {links:[...links.values()],pages:seen.size,limited:todo.length>0||links.size>=1000,errors};
    }
  });
  for (const name of ['startLinks', 'addCollection']) {
    const operation = Engine.prototype[name];
    Engine.prototype[name] = function (...args) { return this.batch(() => operation.apply(this, args)); };
  }
}
module.exports={install,DEFAULT_MEDIA,mediaOptions,mediaArgs,mediaFormat,extractURLs,validMagnet,safeRelative,listZIP,extractZIP};
