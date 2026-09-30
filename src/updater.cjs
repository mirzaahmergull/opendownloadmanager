'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {StateWriter}=require('./persistence.cjs');
async function sha256(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
class EngineUpdater {
  constructor(engine,{fetch:fetcher=globalThis.fetch,releaseAPI,assetBase,versionProbe}={}){
    this.engine=engine;this.fetch=fetcher;this.releaseAPI=releaseAPI;this.assetBase=assetBase;this.versionProbe=versionProbe;
    this.root=path.join(engine.dataDir,'video-engine');fs.mkdirSync(this.root,{recursive:true});this.statePath=path.join(this.root,'updater.json');this.state={channel:'stable',lastCheck:0,active:null,previous:null,pending:null,error:''};this.readyPath='';this.initialized=false;this.busy=false;this.controller=null;
    try{Object.assign(this.state,JSON.parse(fs.readFileSync(this.statePath,'utf8')));}catch{}
    this.writer=new StateWriter(this.statePath,fs.existsSync(this.statePath),error=>{if(error)this.state.error='Could not save engine update: '+error.message;});
    this.ready=this.initialize();
  }
  asset(){return process.platform==='win32'?'yt-dlp.exe':'yt-dlp_macos';}
  candidate(record){if(!record||!/^[a-zA-Z0-9._-]{1,80}$/.test(record.version)||!['stable','nightly'].includes(record.channel)||!/^[a-f0-9]{64}$/.test(record.sha256))return '';return path.join(this.root,'versions',record.channel+'-'+record.version,process.platform==='win32'?'yt-dlp.exe':'yt-dlp');}
  async initialize(){if(this.state.pending){try{const pending=this.candidate(this.state.pending);if(!pending||await sha256(pending)!==this.state.pending.sha256)throw Error();}catch{this.state.pending=null;this.state.error='Pending engine failed integrity checks.';}}const file=this.candidate(this.state.active);if(file){try{if(await sha256(file)!==this.state.active.sha256)throw Error('Checksum mismatch');this.readyPath=file;}catch{this.state.error='Saved engine update failed integrity checks. Using the bundled engine.';}}this.initialized=true;}
  info(){return {busy:this.busy,channel:this.engine.settings.engineChannel||'stable',activeVersion:this.readyPath?this.state.active?.version:'Bundled',pendingVersion:this.state.pending?.version||'',lastCheck:this.state.lastCheck,error:this.state.error};}
  changed(){this.writer.submit(JSON.stringify(this.state));this.engine.changed();}
  async getText(url,max=1024*1024){const response=await this.fetch(url,{headers:{'User-Agent':'OpenDownloadManager/'+require('../package.json').version,Accept:'application/vnd.github+json'},signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(30000)])});if(!response.ok)throw Error('Engine update service returned HTTP '+response.status);let bytes=0,chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>max)throw Error('Engine update metadata exceeds its size limit.');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks).toString('utf8');}
  check(){if(this.currentCheck)return Promise.reject(Error('An engine update check is already running.'));const task=this.performCheck().then(()=>this.info());this.currentCheck=task;task.finally(()=>{if(this.currentCheck===task)this.currentCheck=null;}).catch(()=>{});return task;}
  async performCheck(){
    if(this.busy)throw Error('An engine update check is already running.');if(this.engine.closing)throw Error('The application is shutting down.');
    this.busy=true;await this.ready;if(this.engine.closing){this.busy=false;throw Error('The application is shutting down.');}this.controller=new AbortController();this.state.error='';this.state.lastCheck=Date.now();this.changed();
    let staging;
    try{
      const channel=this.engine.settings.engineChannel||'stable',repo=channel==='nightly'?'yt-dlp/yt-dlp-nightly-builds':'yt-dlp/yt-dlp';
      const release=JSON.parse(await this.getText(this.releaseAPI||'https://api.github.com/repos/'+repo+'/releases/latest'));
      const version=release.tag_name;if(typeof version!=='string'||!/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(version)||release.draft)throw Error('Unrecognized official engine release.');
      if(this.state.active?.version===version&&this.state.active.channel===channel&&this.readyPath)return this.info();
      const base=this.assetBase?this.assetBase(version):'https://github.com/'+repo+'/releases/download/'+version+'/';
      const sums=await this.getText(base+'SHA2-256SUMS',256*1024),line=sums.split(/\r?\n/).find(x=>x.trim().split(/\s+/).at(-1).replace(/^\*/,'')===this.asset());
      const expected=line?.trim().split(/\s+/)[0];if(!/^[a-f0-9]{64}$/i.test(expected||''))throw Error('Official release checksum is missing.');
      staging=path.join(this.root,'.stage-'+crypto.randomUUID());await fsp.mkdir(staging);const file=path.join(staging,process.platform==='win32'?'yt-dlp.exe':'yt-dlp');
      const response=await this.fetch(base+this.asset(),{signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(180000)])});if(!response.ok)throw Error('Engine download returned HTTP '+response.status);
      const handle=await fsp.open(file,'wx',0o700),hash=crypto.createHash('sha256');let size=0,header=Buffer.alloc(0);
      try{for await(const value of response.body){const chunk=Buffer.from(value);size+=chunk.length;if(size>100*1024**2)throw Error('Engine binary exceeds the 100 MB limit.');if(header.length<4)header=Buffer.concat([header,chunk]).subarray(0,4);hash.update(chunk);let offset=0;while(offset<chunk.length){const written=await handle.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw Error('Engine binary disk write failed.');offset+=written.bytesWritten;}}await handle.sync();}finally{await handle.close();}
      if(hash.digest('hex')!==expected.toLowerCase())throw Error('Engine checksum verification failed. Existing engine was preserved.');
      if(process.platform==='win32'?header.subarray(0,2).toString()!=='MZ':!['cafebabe','cafebabf','cffaedfe','cefaedfe'].includes(header.toString('hex')))throw Error('Engine release is not a native executable for this platform.');
      const actual=(this.versionProbe?await this.versionProbe(file):await this.engine.capture(file,['--ignore-config','--version'],15000)).trim();if(actual!==version)throw Error('Downloaded engine version did not match the release.');
      const record={version,channel,sha256:expected.toLowerCase()},destination=this.candidate(record);await fsp.mkdir(path.dirname(destination),{recursive:true});try{await fsp.copyFile(file,destination,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST'||await sha256(destination)!==record.sha256)throw error;}await fsp.chmod(destination,0o755).catch(()=>{});
      this.state.pending=record;this.tryApply();this.changed();await this.writer.flush();if(this.state.error)throw Error(this.state.error);return this.info();
    }catch(error){this.state.error=this.engine.closing?'':error.message;this.changed();throw error;}
    finally{if(staging)await fsp.rm(staging,{recursive:true,force:true}).catch(()=>{});this.busy=false;this.controller=null;this.changed();}
  }
  tryApply(){if(!this.initialized||!this.state.pending||this.engine.closing||this.engine.captures.size||[...this.engine.running.values()].some(r=>r.job?.type==='video'))return false;this.state.previous=this.state.active;this.state.active=this.state.pending;this.state.pending=null;this.readyPath=this.candidate(this.state.active);this.changed();return true;}
  async rollback(){if(this.busy||this.engine.captures.size||[...this.engine.running.values()].some(r=>r.job?.type==='video'))throw Error('Wait for active media operations before changing the engine.');const previous=this.state.previous;this.state.active=null;this.state.pending=null;this.readyPath='';if(previous){const file=this.candidate(previous);if(file&&await sha256(file)===previous.sha256){this.state.active=previous;this.readyPath=file;}}this.state.previous=null;this.state.error='';this.changed();await this.writer.flush();return this.info();}
  poll(){if(this.engine.settings.engineAutoUpdate&&!this.busy&&Date.now()-this.state.lastCheck>24*60*60000)this.check().catch(error=>{if(!this.engine.closing)this.engine.emit('attention',{key:'engine-update',title:'Video engine update failed',message:error.message+' The existing engine remains available.'});});else this.tryApply();}
  async close(){this.controller?.abort();if(this.currentCheck)await this.currentCheck.catch(()=>{});await this.writer.flush();}
}
module.exports={EngineUpdater,sha256};
