'use strict';
const DEFAULT_PACING={enabled:true,concurrent:1,minDelay:15,maxDelay:30,restEvery:50,restMinutes:5,smart:true,cooldownMinutes:30,requestDelay:1,fragmentWorkers:2};
function pacing(value={}){
  const v={...DEFAULT_PACING,...value};
  for(const key of ['enabled','smart'])v[key]=!!v[key];
  const bounds={concurrent:[1,4],minDelay:[0,3600],maxDelay:[0,7200],restEvery:[0,5000],restMinutes:[0,1440],cooldownMinutes:[1,1440],requestDelay:[0,30],fragmentWorkers:[1,4]};
  for(const [key,[min,max]] of Object.entries(bounds)){const n=Number(v[key]);if(!Number.isFinite(n)||n<min||n>max)throw Error('Invalid video pacing value: '+key);v[key]=Math.floor(n);}
  if(v.maxDelay<v.minDelay)throw Error('Maximum video delay must be at least the minimum delay.');
  return Object.fromEntries(Object.keys(DEFAULT_PACING).map(k=>[k,v[k]]));
}
function youtube(url){try{return /(^|\.)(youtube(?:-nocookie)?\.com|youtu\.be)$/.test(new URL(url).hostname.toLowerCase());}catch{return false;}}
function classify(error){
  const text=String(error?.message||error);
  if(['LOCAL_SPACE','ENOSPC','EDQUOT'].includes(error?.code)||/No space left on device|disk (?:is )?full|not enough space on the disk/i.test(text))return 'space';
  if(error?.code==='CLOUD_UPLOAD')return 'cloud';
  if(/HTTP Error 429|too many requests|rate.?limit|This content isn.t available, try again later/i.test(text))return 'rate';
  if(/HTTP Error 403|403.*Forbidden|confirm you.re not a bot|sign in to confirm|login required|authentication required|cookies.*(?:required|expired)|PO Token.*required|account.*(?:blocked|suspended)/i.test(text))return 'session';
  return '';
}
function normalizeCookies(cookies){
  if(!Array.isArray(cookies)||cookies.length>200)throw Error('Invalid YouTube session.');
  return cookies.filter(c=>c&&typeof c.domain==='string'&&/^(\.)?([a-z0-9-]+\.)*youtube\.com$/i.test(c.domain)&&typeof c.name==='string'&&typeof c.value==='string'&&!/[\r\n\t]/.test(c.name+c.value+c.domain+(c.path||'/'))&&c.name.length<256&&c.value.length<8192).map(c=>({domain:c.domain,name:c.name,value:c.value,path:c.path||'/',secure:!!c.secure,httpOnly:!!c.httpOnly,expiry:Number(c.expiry||c.expirationDate)||0}));
}
class MediaPolicy {
  constructor(engine,stored={}) {this.engine=engine;this.gate={nextStartAt:0,cooldownUntil:0,starts:0,strikes:0,blocked:false,reason:'',...stored};this.requests=new Map();}
  policy(job){return pacing(this.engine.batches?.find(b=>b.id===job?.batchId)?.pacing||this.engine.settings.videoPacing);}
  eligible(job,now=Date.now()){
    const batch=this.engine.batches?.find(b=>b.id===job.batchId);
    if(batch&&(!['running'].includes(batch.status)||batch.importing))return false;
    if(job.localReady)return true;
    if(job.type!=='video'||!youtube(job.url))return true;
    const p=this.policy(job);if(!p.enabled)return true;
    if(this.gate.blocked||now<Math.max(this.gate.nextStartAt,this.gate.cooldownUntil))return false;
    const active=[...this.engine.running.values()].filter(r=>r.job?.type==='video'&&youtube(r.job.url)).length;
    return active<p.concurrent;
  }
  started(job,now=Date.now()){
    if(job.localReady||job.type!=='video'||!youtube(job.url))return;
    const p=this.policy(job);if(!p.enabled)return;
    const g=this.gate;g.starts++;
    job.mediaStartSequence=g.starts;
    let wait=(p.minDelay+Math.random()*(p.maxDelay-p.minDelay))*1000;
    if(p.restEvery&&g.starts%p.restEvery===0)wait=Math.max(wait,p.restMinutes*60000);
    if(p.smart)wait*=1+Math.min(3,g.strikes);
    g.nextStartAt=now+Math.round(wait);
  }
  finished(job,now=Date.now()){
    if(job.status!=='complete'||job.type!=='video'||!youtube(job.url))return;
    const p=this.policy(job);if(!p.enabled)return;
    let wait=(p.minDelay+Math.random()*(p.maxDelay-p.minDelay))*1000;
    if(p.restEvery&&job.mediaStartSequence%p.restEvery===0)wait=Math.max(wait,p.restMinutes*60000);
    if(p.smart)wait*=1+Math.min(3,this.gate.strikes);
    this.gate.nextStartAt=Math.max(this.gate.nextStartAt,now+Math.round(wait));
  }
  failure(job,error){
    if(job.type!=='video'||!youtube(job.url)||!this.policy(job).enabled||!this.policy(job).smart)return false;
    const kind=classify(error);if(!['rate','session'].includes(kind))return false;
    const g=this.gate,p=this.policy(job);g.strikes++;
    if(kind==='rate'&&g.strikes<3){g.cooldownUntil=Date.now()+Math.min(360, p.cooldownMinutes*2**(g.strikes-1))*60000;g.reason='YouTube rate limit: cooling down until '+new Date(g.cooldownUntil).toLocaleTimeString();job.status='queued';job.retryAt=g.cooldownUntil;}
    else {g.blocked=true;g.reason=kind==='session'?'YouTube needs attention. Check the browser session before resuming.':'Repeated YouTube rate limits. Review the batch before resuming.';job.status='error';}
    this.engine.emit('attention',{key:'youtube-'+kind,title:'YouTube downloads waiting',message:g.reason,jobId:job.id});return true;
  }
  control(action){if(action==='pause'){this.gate.blocked=true;this.gate.reason='YouTube downloads paused.';}else if(action==='resume'){this.gate.blocked=false;this.gate.reason='';this.gate.cooldownUntil=0;this.gate.nextStartAt=0;this.gate.strikes=0;}else throw Error('Unknown YouTube control.');this.engine.changed();this.engine.tick();return this.info();}
  info(){const session=this.engine.vault?.get('youtube-session');return {gate:{...this.gate},session:{available:!!session?.cookies?.length,sharedAt:session?.sharedAt||0,browser:session?.browser||'',encrypted:!!this.engine.encryptSecret},pacing:pacing(this.engine.settings.videoPacing)};}
  cookies(url){if(!youtube(url))return [];return (this.engine.vault?.get('youtube-session')?.cookies||[]).filter(c=>!c.expiry||c.expiry>Date.now()/1000);}
  async share(input){const cookies=normalizeCookies(input.cookies);if(!cookies.length)throw Error('No YouTube cookies found. Open YouTube in the browser, then share again.');if(input.requestId){const request=this.requests.get(input.requestId);if(!request||request.expires<Date.now())throw Error('Session request expired. Start again from the desktop app.');}
    await this.engine.vault.set('youtube-session',{cookies,sharedAt:Date.now(),browser:String(input.browser||'Chrome / Edge').slice(0,80)},input.refreshOf===undefined?undefined:{field:'sharedAt',value:input.refreshOf});if(input.requestId)this.requests.delete(input.requestId);this.engine.changed();return this.info().session;}
  async forget(){await this.engine.vault.set('youtube-session',null);this.engine.changed();}
  request(){const id=require('node:crypto').randomBytes(16).toString('hex');this.pending();if(this.requests.size>=4)throw Error('A browser session request is already pending.');this.requests.set(id,{id,expires:Date.now()+10*60000});return this.requests.get(id);}
  pending(){for(const [id,r] of this.requests)if(r.expires<Date.now())this.requests.delete(id);return [...this.requests.values()];}
}
module.exports={MediaPolicy,DEFAULT_PACING,pacing,youtube,classify,normalizeCookies};
