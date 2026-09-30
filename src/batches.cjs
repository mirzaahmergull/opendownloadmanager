'use strict';
const path=require('node:path'),crypto=require('node:crypto'),fsp=require('node:fs/promises');
const {pacing,classify,youtube}=require('./media-policy.cjs');
class BatchManager {
  constructor(engine){this.engine=engine;this.imports=new Map();for(const b of engine.batches){b.importing=false;for(const g of b.playlists)if(g.status==='importing')g.status='pending';}
    for(const j of engine.jobs){if(j.resumeOnStartup){const b=engine.batches.find(v=>v.id===j.batchId);if(b?.autoResume&&['running','cooldown'].includes(b.status)&&j.status!=='complete')j.status='queued';delete j.resumeOnStartup;}}
    this.timer=setInterval(()=>this.poll(),1000);this.timer.unref();queueMicrotask(()=>this.poll());
  }
  create(input){
    this.engine.ensureOpen();if(!Array.isArray(input.urls)||!input.urls.length||input.urls.length>100)throw Error('Paste 1 to 100 playlist URLs.');const urls=[...new Set(input.urls.map(url=>require('./net.cjs').webURL(url).href))];
    const limit=Number(input.limit||10000);if(!Number.isInteger(limit)||limit<1||limit>10000)throw Error('Inspect up to 10,000 entries per playlist.');
    const policy=pacing(input.pacing||this.engine.settings.videoPacing),media=require('./advanced.cjs').mediaOptions(input.media||this.engine.settings.media),id=crypto.randomUUID(),name=this.engine.safeName(input.name||'Video batch').slice(0,100),directory=input.directory||path.join(this.engine.settings.downloadDir,name+'--'+id.slice(0,8));
    if(!path.isAbsolute(directory))throw Error('Choose an absolute batch folder.');if(input.cloudProfileId)this.engine.cloudManager.get(input.cloudProfileId);
    if(input.deleteLocal&&!input.cloudProfileId)throw Error('Choose a cloud destination before enabling local cleanup.');if(this.engine.batches.filter(b=>!['complete','complete-with-errors'].includes(b.status)).length>=18)throw Error('Finish an existing batch before adding another.');
    const batch={id,name,directory,queue:'Batch '+name.slice(0,58)+' '+id.slice(0,8),createdAt:Date.now(),status:input.start===false?'paused':'running',importing:false,autoResume:input.autoResume!==false,limit,pacing:policy,media,cloudProfileId:input.cloudProfileId||'',deleteLocal:!!input.deleteLocal,error:'',playlists:urls.map((url,index)=>({id:crypto.randomUUID(),url,index:index+1,title:'Playlist '+(index+1),folderName:'',status:'pending',entries:0,error:''}))};
    this.engine.batch(()=>{this.engine.setQueue({name:batch.queue,enabled:batch.status==='running',concurrent:policy.concurrent});this.engine.batches.push(batch);this.engine.changed();});this.poll();return this.summary().find(b=>b.id===id);
  }
  get(id){const b=this.engine.batches.find(v=>v.id===id);if(!b)throw Error('Batch no longer exists.');return b;}
  poll(){if(this.engine.closing)return;for(const b of this.engine.batches){if(b.status==='cooldown'&&!this.engine.mediaPolicy.gate.blocked&&Date.now()>=this.engine.mediaPolicy.gate.cooldownUntil){b.status='running';b.error='';for(const g of b.playlists)if(g.status==='error')g.status='pending';this.engine.changed();}if(b.status==='running'&&b.playlists.some(g=>g.status==='pending')&&!this.imports.size)this.startImport(b);}}
  startImport(batch){const controller=new AbortController();batch.importing=true;const task=this.import(batch,controller.signal).finally(()=>{batch.importing=false;this.imports.delete(batch.id);if(!this.engine.closing){this.engine.changed();this.engine.tick();this.poll();}});this.imports.set(batch.id,{controller,task});task.catch(()=>{});}
  async import(batch,signal){
    for(const group of batch.playlists){if(group.status!=='pending')continue;if(this.engine.closing||batch.status!=='running'||signal.aborted)return;group.status='importing';batch.error='';this.engine.changed();
      try{
        const collection=await this.engine.inspectCollection(group.url,batch.limit,signal);signal.throwIfAborted();if(batch.status!=='running')return;
        if(!collection.entries.length)throw Error('No videos were found in this playlist.');if(this.engine.jobs.filter(j=>j.batchId===batch.id).length+collection.entries.length>50000)throw Error('A batch can contain up to 50,000 videos. Split this work into another batch.');
        group.title=String(collection.title||group.title).slice(0,170);group.folderName ||= String(group.index).padStart(3,'0')+' - '+this.engine.safeName(group.title).slice(0,110)+'--'+group.id.slice(0,8);
        this.engine.batch(()=>{this.engine.addCollection({entries:collection.entries,title:group.title,directory:path.join(batch.directory,group.folderName),queue:batch.queue,start:true,media:batch.media,batchId:batch.id,playlistId:group.id,cloudProfileId:batch.cloudProfileId,deleteLocal:batch.deleteLocal});group.entries=collection.entries.length;group.truncated=collection.truncated;group.status='ready';group.error='';this.engine.changed();});
      }catch(error){if(signal.aborted||this.engine.closing){group.status='pending';return;}group.error=error.message;group.status='error';const gate=this.engine.mediaPolicy.gate;batch.status=classify(error)==='rate'&&!gate.blocked?'cooldown':'blocked';batch.error=gate.reason||'Playlist inspection failed: '+error.message;this.engine.emit('attention',{key:'batch-import-'+batch.id,title:'Playlist batch needs attention',message:batch.error});this.engine.changed();return;}
    }
  }
  async control(id,action,playlistId){
    const b=this.get(id);if(action==='pause'){b.status='paused';this.imports.get(id)?.controller.abort();await this.engine.pauseMany(this.engine.jobs.filter(j=>j.batchId===id&&j.status!=='complete').map(j=>j.id));await this.imports.get(id)?.task;this.engine.setQueue({name:b.queue,enabled:false});}
    else if(action==='resume'||action==='skip-playlist'){
      if(action==='skip-playlist'){const group=b.playlists.find(g=>g.id===playlistId);if(!group||group.status!=='error')throw Error('Choose a failed playlist to skip.');group.status='skipped';group.error='';}else for(const group of b.playlists)if(group.status==='error')group.status='pending';
      b.status='running';b.error='';this.engine.batch(()=>{this.engine.setQueue({name:b.queue,enabled:true});this.engine.resumeMany(this.engine.jobs.filter(j=>j.batchId===id&&['error','paused'].includes(j.status)).map(j=>j.id));this.engine.changed();});this.poll();
    }else if(action==='remove'){await this.control(id,'pause');await this.engine.removeMany(this.engine.jobs.filter(j=>j.batchId===id).map(j=>j.id));this.engine.batches=this.engine.batches.filter(v=>v.id!==id);this.engine.queues=this.engine.queues.filter(q=>q.name!==b.queue||this.engine.jobs.some(j=>j.queue===q.name));}else throw Error('Unknown batch action.');this.engine.changed();this.engine.tick();return this.summary().find(v=>v.id===id);
  }
  finished(job){const batch=this.engine.batches.find(b=>b.id===job.batchId);if(!batch||batch.importing||batch.playlists.some(g=>!['ready','skipped'].includes(g.status)))return;const jobs=this.engine.jobs.filter(j=>j.batchId===batch.id);if(jobs.length&&jobs.every(j=>['complete','error'].includes(j.status))){batch.status=jobs.some(j=>j.status==='error')?'complete-with-errors':'complete';batch.finishedAt=Date.now();batch.finishedCounts={complete:jobs.filter(j=>j.status==='complete').length,error:jobs.filter(j=>j.status==='error').length,total:jobs.length};}}
  failure(job,error){const kind=classify(error);if(!['cloud','space'].includes(kind))return false;const batch=this.engine.batches.find(b=>b.id===job.batchId);if(batch){batch.status='blocked';batch.error=error.message;}job.status='error';job.error=error.message;this.engine.emit('attention',{key:'batch-'+(job.batchId||job.id)+'-'+kind,title:kind==='cloud'?'Cloud upload needs attention':'Local storage needs attention',message:error.message,jobId:job.id});return true;}
  summary(){const counts=new Map(),groups=new Map();for(const j of this.engine.jobs){if(!j.batchId)continue;const c=counts.get(j.batchId)||{total:0,complete:0,error:0,queued:0,paused:0,active:0,uploading:0};c.total++;if(['complete','error','queued','paused','uploading'].includes(j.status))c[j.status]++;if(['probing','downloading','assembling','uploading'].includes(j.status))c.active++;counts.set(j.batchId,c);const g=groups.get(j.playlistId)||{total:0,complete:0,error:0};g.total++;if(['complete','error'].includes(j.status))g[j.status]++;groups.set(j.playlistId,g);}
    return this.engine.batches.map(b=>({...b,counts:counts.get(b.id)||b.finishedCounts||{total:0,complete:0,error:0,active:0},playlists:b.playlists.map(g=>({...g,counts:groups.get(g.id)||{total:0,complete:0,error:0}}))}));}
  async checkSpace(job){if(!job.cloudProfileId)return;const b=this.engine.batches.find(v=>v.id===job.batchId);const estimate=b?.largestVideoBytes||0;const reserve=Number(this.engine.settings.diskReserveMiB||2048)*1024**2;
    for(const directory of [job.directory,this.engine.tempDir]){const info=await fsp.statfs(directory);const free=Number(info.bavail)*Number(info.bsize);if(free<reserve+2*estimate){const error=new Error('Available local space is below the batch reserve. Free space or reduce the reserve, then resume this batch.');error.code='LOCAL_SPACE';throw error;}}
  }
  async close(){clearInterval(this.timer);for(const {controller} of this.imports.values())controller.abort();await Promise.allSettled([...this.imports.values()].map(v=>v.task));}
}
module.exports={BatchManager};
