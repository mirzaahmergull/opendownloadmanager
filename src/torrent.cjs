const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { request, webURL } = require('./net.cjs');
const { validMagnet, safeRelative } = require('./advanced.cjs');
let modulePromise;
async function modules() { return modulePromise ||= Promise.all([import('webtorrent'), import('parse-torrent')]); }
function clientOptions(engine) { return { utp:false, natUpnp:false, natPmp:false, lsd:false, tracker:{wrtc:false}, downloadLimit:engine.settings.speedLimit ? engine.settings.speedLimit*1024 : -1, uploadLimit:engine.settings.uploadLimit*1024 }; }
async function torrentInput(input, proxy='') {
  if(input.data) { if(typeof input.data!=='string' || input.data.length>6*1024**2) throw Error('Torrent metadata exceeds 4 MB.');return Buffer.from(input.data,'base64'); }
  if(String(input.url).startsWith('magnet:')) return validMagnet(input.url);
  webURL(input.url);const res=await request(input.url,{signal:AbortSignal.timeout(20000),proxy});if(res.statusCode>=400){res.destroy();throw Error('Torrent metadata HTTP '+res.statusCode);}
  let size=0,chunks=[];for await(const c of res){size+=c.length;if(size>4*1024**2){res.destroy();throw Error('Torrent metadata exceeds 4 MB.');}chunks.push(c);}return Buffer.concat(chunks);
}
function metadata(torrent) { return {infoHash:torrent.infoHash,name:torrent.name,files:torrent.files.map((f,index)=>({index,name:safeRelative(f.path),size:f.length})),size:torrent.length}; }
async function inspectTorrent(engine,input) {
  const [{default:WebTorrent},{default:parse}]=await modules(), source=await torrentInput(input,engine.settings.proxyURL);
  if(typeof source!=='string'){const p=await parse(source);return {...metadata(p),data:Buffer.from(source).toString('base64')};}
  const client=new WebTorrent(clientOptions(engine));
  try{
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('No torrent metadata received in 45 seconds. Check trackers and peers.')),45000);
      const fail=e=>{clearTimeout(timer);reject(e);};client.on('error',fail);
      const t=client.add(source,{deselect:true,path:path.join(engine.tempDir,'metadata-'+crypto.randomUUID())},torrent=>{try{const m=metadata(torrent);clearTimeout(timer);resolve({...m,data:Buffer.from(torrent.torrentFile).toString('base64')});}catch(e){fail(e);}});t.on('error',fail);
    });
  }finally{await new Promise(r=>client.destroy(r));}
}
async function runTorrent(engine,job,controller) {
  const [{default:WebTorrent},{default:parse}]=await modules();
  if(engine.settings.proxyURL) throw Error('Torrent peer traffic does not use the HTTP proxy. Clear the proxy before starting a torrent.');
  const source=await torrentInput({url:job.url,data:job.torrentData});
  if(typeof source!=='string'){const p=await parse(source);metadata(p);}
  controller.signal.throwIfAborted();
  const client=new WebTorrent(clientOptions(engine));
  let timer;
  try {
    const torrent=await new Promise((resolve,reject)=>{
      const onAbort=()=>reject(controller.signal.reason || Error('Torrent paused.'));
      controller.signal.addEventListener('abort',onAbort,{once:true});
      const fail=e=>reject(e);client.on('error',fail);
      const t=client.add(source,{path:path.join(engine.jobTemp(job.id),'torrent'),deselect:true,addUID:true},t=>{
        try{
          const m=metadata(t);job.torrentData=Buffer.from(t.torrentFile).toString('base64');job.infoHash=m.infoHash;
          if(!job.torrentSelection)job.torrentSelection=m.files.map(f=>f.index);
          job.torrentSelection=[...new Set(job.torrentSelection)];
          if(!job.torrentSelection.length || job.torrentSelection.some(i=>!m.files[i]))throw Error('Select at least one valid torrent file.');
          for(const i of job.torrentSelection)t.files[i].select();
          job.torrentFiles=m.files;job.filename=engine.safeName(t.name);job.size=job.torrentSelection.reduce((s,i)=>s+t.files[i].length,0);job.status='downloading';job.resumable=true;engine.changed();
          const update=()=>{
            job.downloaded=job.torrentSelection.reduce((s,i)=>s+t.files[i].downloaded,0);job.speed=t.downloadSpeed;job.peers=t.numPeers;job.uploaded=t.uploaded;job.eta=job.speed?(job.size-job.downloaded)/job.speed:null;engine.progressChanged();
            if(job.torrentSelection.every(i=>t.files[i].done)){clearInterval(timer);controller.signal.removeEventListener('abort',onAbort);resolve(t);}
          };
          timer=setInterval(update,500);update();
        }catch(e){reject(e);}
      });t.on('error',fail);
    });
    controller.signal.throwIfAborted();job.status='assembling';engine.changed();
    const root=path.join(engine.jobTemp(job.id),'torrent');
    const outputBase=engine.uniqueOutput(job);await fsp.mkdir(outputBase,{recursive:false});job.outputs=[];
    for(const index of job.torrentSelection){
      const file=torrent.files[index],relative=safeRelative(file.path);
      const target=path.join(outputBase,relative);await fsp.mkdir(path.dirname(target),{recursive:true});await pipeline(file.createReadStream(),fs.createWriteStream(target,{flags:'wx'}));
      const hash=crypto.createHash('sha256');for await(const c of fs.createReadStream(target)){controller.signal.throwIfAborted();hash.update(c);}job.outputs.push({path:target,size:file.length,checksum:hash.digest('hex')});
    }
    job.status='complete';job.downloaded=job.size;job.speed=0;job.eta=0;job.completedAt=new Date().toISOString();job.checksum=job.outputs.length===1?job.outputs[0].checksum:'';job.peers=0;
    engine.emit('complete',engine.publicJob(job));
  } finally {clearInterval(timer);await new Promise(r=>client.destroy(r));if(job.status==='complete')await require('./publication.cjs').cleanupTemp(engine,job);}
}
function install(Engine){
  Engine.prototype.inspectTorrent=function(input){return inspectTorrent(this,input);};
  Engine.prototype.addTorrent=function(input){
    const url=input.data ? 'https://torrent.local/'+(input.infoHash || crypto.randomUUID())+'.torrent' : String(input.url || '');
    if(!input.data) url.startsWith('magnet:')?validMagnet(url):webURL(url);
    if(input.data && (typeof input.data!=='string'||input.data.length>6*1024**2))throw Error('Torrent metadata exceeds 4 MB.');
    if(input.selection && (!Array.isArray(input.selection)||input.selection.some(n=>!Number.isSafeInteger(n)||n<0)||!input.selection.length))throw Error('Select valid torrent files.');
    // Create stopped, then assign transport fields before any scheduler can launch it.
    const created=this.add({url:url.startsWith('magnet:')?'https://torrent.local/magnet':url,filename:input.name || 'Torrent',directory:input.directory || this.settings.downloadDir,queue:input.queue,start:false,type:'file'});
    const job=this.get(created.id);job.type='torrent';job.url=url;job.torrentData=input.data || '';job.torrentSelection=input.selection?[...new Set(input.selection)]:undefined;job.category='Other';job.resumable=true;
    if(input.start!==false)this.resume(job.id);else this.changed();return this.publicJob(job);
  };
}
module.exports={install,runTorrent,inspectTorrent,torrentInput};
