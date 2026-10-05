'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
let s3SDK;const s3Types=()=>s3SDK ||= require('@aws-sdk/client-s3');
async function fingerprint(file,signal){const sha=crypto.createHash('sha256'),md5=crypto.createHash('md5');const before=await fsp.stat(file);for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024})){signal?.throwIfAborted();sha.update(chunk);md5.update(chunk);}const after=await fsp.stat(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw Error('Local file changed during verification.');return {size:after.size,sha256:sha.digest('hex'),md5:md5.digest('base64')};}
// Cloudflare R2 speaks the S3 API at a per-account endpoint; the bucket region is always "auto".
const R2_JURISDICTIONS={'':'',eu:'.eu',fedramp:'.fedramp'};
const r2Endpoint=(accountId,jurisdiction='')=>'https://'+accountId+R2_JURISDICTIONS[jurisdiction]+'.r2.cloudflarestorage.com';
function profile(input){
  if(!['s3','r2','gcs'].includes(input.provider))throw Error('Choose Amazon S3, Cloudflare R2 or Google Cloud Storage.');
  const r2=input.provider==='r2',bucket=String(input.bucket||'').trim();if(!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)||bucket.includes('..')||input.provider==='s3'&&(bucket.length>63||bucket.includes('_'))||r2&&!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw Error('Enter a valid bucket name.');
  const prefix=String(input.prefix||'').replace(/^\/+|\/+$/g,'');if(prefix.length>500||/[\x00-\x1f\\]/.test(prefix)||prefix.split('/').some(p=>p==='..'||p==='.'||!p))if(prefix)throw Error('Use a plain object prefix without relative paths.');
  let endpoint=String(input.endpoint||'').trim();if(endpoint){const url=new URL(endpoint);if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Use an HTTPS S3 endpoint, or a local development endpoint.');endpoint=url.href.replace(/\/$/,'');if(input.provider==='gcs')throw Error('GCS uses the Google storage endpoint.');}
  const accountId=r2?String(input.accountId||'').trim().toLowerCase():'',jurisdiction=r2?String(input.jurisdiction||''):'';
  if(r2){if(!Object.hasOwn(R2_JURISDICTIONS,jurisdiction))throw Error('Choose a valid R2 jurisdiction.');if(accountId&&!/^[a-f0-9]{32}$/.test(accountId))throw Error('Enter the 32-character Cloudflare account ID.');if(!accountId&&!endpoint)throw Error('Enter your Cloudflare account ID.');endpoint||=r2Endpoint(accountId,jurisdiction);}
  const region=r2?'auto':String(input.region||'us-east-1');if(!/^[a-z0-9-]{1,80}$/.test(region))throw Error('Invalid S3 region.');
  return {id:input.id||crypto.randomUUID(),name:String(input.name||input.provider.toUpperCase()+' / '+bucket).slice(0,80),provider:input.provider,bucket,prefix,region,endpoint,forcePathStyle:r2||!!input.forcePathStyle,accountId,jurisdiction,auth:input.auth==='stored'?'stored':'default',projectId:String(input.projectId||'').slice(0,120)};
}
// Default R2 authentication prefers R2-specific variables so ambient AWS credentials are never sent to Cloudflare by accident.
function r2EnvCredentials(env=process.env){return env.R2_ACCESS_KEY_ID&&env.R2_SECRET_ACCESS_KEY?{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY,sessionToken:env.R2_SESSION_TOKEN||undefined}:undefined;}
class CloudManager {
  constructor(engine,options={}){this.engine=engine;this.options=options;this.clients=new Map();}
  profiles(){return this.engine.cloudProfiles.map(p=>({...p,hasCredentials:!!this.engine.vault.get('cloud:'+p.id)}));}
  async configure(input){
    this.engine.ensureOpen();const p=profile(input);if(!/^[a-f0-9-]{36}$/.test(p.id))throw Error('Invalid cloud profile ID.');
    const old=this.engine.cloudProfiles.find(v=>v.id===p.id);
    if(old&&this.engine.jobs.some(j=>j.cloudProfileId===p.id&&j.status!=='complete')&&['provider','bucket','prefix','region','endpoint','forcePathStyle','accountId','jurisdiction'].some(k=>old[k]!==p[k]))throw Error('This destination is in a batch. Create another profile to change its bucket or prefix.');
    if([...this.engine.running.values()].some(r=>r.job?.cloudProfileId===p.id))throw Error('Pause this cloud batch before changing credentials.');
    if(input.credentials){if(p.provider!=='gcs'){const c=input.credentials;if(!c.accessKeyId||!c.secretAccessKey||[c.accessKeyId,c.secretAccessKey,c.sessionToken||''].some(v=>typeof v!=='string'||v.length>8192||/[\r\n]/.test(v)))throw Error('Enter valid '+(p.provider==='r2'?'R2':'S3')+' credentials.');await this.engine.vault.set('cloud:'+p.id,{accessKeyId:c.accessKeyId,secretAccessKey:c.secretAccessKey,sessionToken:c.sessionToken||undefined});}
      else {const c=input.credentials;if(c.type!=='service_account'||typeof c.client_email!=='string'||typeof c.private_key!=='string'||!c.private_key.includes('BEGIN PRIVATE KEY'))throw Error('Choose a Google service-account JSON key.');await this.engine.vault.set('cloud:'+p.id,c);}p.auth='stored';}
    if(p.auth==='stored'&&!this.engine.vault.get('cloud:'+p.id))throw Error('Add credentials or select default SDK credentials.');
    if(old)Object.assign(old,p);else{if(this.engine.cloudProfiles.length>=20)throw Error('Maximum 20 cloud destinations.');this.engine.cloudProfiles.push(p);}this.clients.get(p.id)?.destroy?.();this.clients.delete(p.id);this.engine.changed();return this.profiles().find(v=>v.id===p.id);
  }
  async remove(id){if(this.engine.jobs.some(j=>j.cloudProfileId===id&&j.status!=='complete'))throw Error('Finish or remove the associated batches before removing this destination.');this.engine.cloudProfiles=this.engine.cloudProfiles.filter(p=>p.id!==id);await this.engine.vault.set('cloud:'+id,null);this.clients.get(id)?.destroy?.();this.clients.delete(id);this.engine.changed();}
  get(id){const p=this.engine.cloudProfiles.find(v=>v.id===id);if(!p)throw Error('Cloud destination is missing. Configure it before resuming.');return p;}
  s3(p){if(this.options.s3ClientFactory)return this.options.s3ClientFactory(p);if(!this.clients.has(p.id)){const credentials=p.auth==='stored'?this.engine.vault.get('cloud:'+p.id):p.provider==='r2'?r2EnvCredentials(this.options.env):undefined;if(p.auth==='stored'&&!credentials)throw Error('Cloud credentials are unavailable.');
    // R2 rejects the SDK's default flexible-checksum headers; integrity is enforced with Content-MD5 instead.
    this.clients.set(p.id,new (s3Types().S3Client)({region:p.region,endpoint:p.endpoint||undefined,forcePathStyle:p.forcePathStyle,credentials,maxAttempts:3,...(p.provider==='r2'?{requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'}:{})}));}return this.clients.get(p.id);}
  gcs(p){if(this.options.gcsStorageFactory)return this.options.gcsStorageFactory(p);if(!this.clients.has(p.id)){const credentials=p.auth==='stored'?this.engine.vault.get('cloud:'+p.id):undefined;if(p.auth==='stored'&&!credentials)throw Error('Cloud credentials are unavailable.');this.clients.set(p.id,new (require('@google-cloud/storage').Storage)({retryOptions:{totalTimeout:60,maxRetryDelay:8,maxRetries:3},projectId:p.projectId||credentials?.project_id||undefined,credentials}));}return this.clients.get(p.id);}
  async test(id){const p=this.get(id);if(p.provider!=='gcs'){const {HeadBucketCommand}=require('@aws-sdk/client-s3');await this.s3(p).send(new HeadBucketCommand({Bucket:p.bucket}),{abortSignal:AbortSignal.timeout(30000)});}else await this.gcs(p).bucket(p.bucket).getMetadata();return {ok:true,bucket:p.bucket,provider:p.provider};}
  publicInfo(job){const c=job.cloud;if(!c)return undefined;return {state:c.state,error:c.error||'',uploadedBytes:c.uploadedBytes||0,totalBytes:c.totalBytes||0,deleteLocal:!!c.deleteLocal,files:(c.files||[]).map(f=>({key:f.key,size:f.size,uri:f.uri,state:f.state,localDeleted:!!f.localDeleted}))};}
  async checkpoint(){if(!this.engine.save())throw Error(this.engine.persistenceWarning||'Could not save cloud progress.');await this.engine.stateWriter?.flush();if(this.engine.persistenceWarning)throw Error(this.engine.persistenceWarning);}
  progress(job,bytes){job.cloud.uploadedBytes=bytes;this.engine.progressChanged();}
  async prepare(job,signal){
    const p=this.get(job.cloudProfileId);if(job.cloud?.files?.length){if(job.cloud.bucket!==p.bucket||job.cloud.provider!==p.provider)throw Error('Cloud destination changed. Local files were kept.');return p;}
    const files=[job.output,...(job.sidecars||[])],records=[];const batch=this.engine.batches.find(b=>b.id===job.batchId),playlist=batch?.playlists.find(g=>g.id===job.playlistId);
    const folder=[p.prefix,batch?this.engine.safeName(batch.name):'Downloads',playlist?.folderName||this.engine.safeName(job.package||'Files')].filter(Boolean).join('/');
    for(const file of files){signal.throwIfAborted();if(!path.resolve(file).startsWith(path.resolve(job.directory)+path.sep))throw Error('Cloud file is outside the download directory.');const hash=await fingerprint(file,signal);if(file===job.output&&hash.sha256!==job.checksum)throw Error('Downloaded file failed its pre-upload SHA-256 check.');const ext=path.extname(file),name=path.basename(file,ext)+'--'+job.id+ext;records.push({path:file,key:folder+'/'+name,...hash,state:'pending',parts:[]});}
    job.cloud={state:'pending',bucket:p.bucket,provider:p.provider,deleteLocal:!!job.deleteLocal,files:records,totalBytes:records.reduce((sum,f)=>sum+f.size,0),uploadedBytes:0};await this.checkpoint();return p;
  }
  async upload(job,signal){
    try{
      signal.throwIfAborted();const p=await this.prepare(job,signal);signal.throwIfAborted();job.status='uploading';job.speed=0;job.eta=null;job.cloud.state='uploading';job.cloud.error='';this.engine.changed();let before=0;
      for(const f of job.cloud.files){signal.throwIfAborted();
        if(f.state!=='verified'){const hash=await fingerprint(f.path,signal);if(hash.sha256!==f.sha256||hash.size!==f.size)throw Error('Local file changed after download. It was kept.');if(p.provider==='gcs')await this.uploadGCS(p,f,signal,bytes=>this.progress(job,before+bytes));else await this.uploadS3(p,f,signal,bytes=>this.progress(job,before+bytes));signal.throwIfAborted();f.state='verified';f.uri={s3:'s3',r2:'r2',gcs:'gs'}[p.provider]+'://'+p.bucket+'/'+f.key;await this.checkpoint();}
        else await this.verify(p,f,signal);
        before+=f.size;this.progress(job,before);
      }
      job.cloud.state='verified';await this.checkpoint();
      if(job.cloud.deleteLocal){for(const f of job.cloud.files){signal.throwIfAborted();if(!fs.existsSync(f.path)){f.localDeleted=true;continue;}const hash=await fingerprint(f.path,signal);if(hash.sha256!==f.sha256||hash.size!==f.size)throw Error('Local file changed; automatic cleanup was stopped.');await fsp.unlink(f.path);f.localDeleted=true;}await this.checkpoint();}
      signal.throwIfAborted();job.cloud.state='complete';job.status='complete';job.speed=0;job.completedAt=new Date().toISOString();this.engine.changed();this.engine.emit('complete',this.engine.publicJob(job));
    }catch(error){if(signal.aborted)throw error;if(job.cloud){job.cloud.state='error';job.cloud.error=error.message;}const failure=new Error('Cloud upload stopped: '+error.message+'. Local files are retained unless their remote copies were already verified.');failure.code='CLOUD_UPLOAD';throw failure;}
  }
  async headS3(p,f,signal){return this.s3(p).send(new (s3Types().HeadObjectCommand)({Bucket:p.bucket,Key:f.key,...(p.provider==='r2'?{}:{ChecksumMode:'ENABLED'})}),{abortSignal:signal});}
  // S3 compares the provider's SHA-256 checksum. R2 compares the ETag recorded after Content-MD5-validated writes.
  validS3(head,f,p){if(Number(head.ContentLength)!==f.size||head.Metadata?.['odm-sha256']!==f.sha256)return false;return p.provider==='r2'?!!f.remoteChecksum&&head.ETag===f.remoteChecksum:head.ChecksumSHA256===f.remoteChecksum;}
  async verify(p,f,signal){if(p.provider!=='gcs'){const h=await this.headS3(p,f,signal);if(!this.validS3(h,f,p))throw Error((p.provider==='r2'?'R2':'S3')+' object size or checksum did not match.');}else{const [m]=await this.gcs(p).bucket(p.bucket).file(f.key).getMetadata();if(Number(m.size)!==f.size||m.md5Hash!==f.md5||m.metadata?.odm_sha256!==f.sha256)throw Error('GCS object size or MD5 checksum did not match.');}signal?.throwIfAborted();}
  async uploadS3(p,f,signal,progress,resets=0){
    const {PutObjectCommand,CreateMultipartUploadCommand,UploadPartCommand,ListPartsCommand,CompleteMultipartUploadCommand}=s3Types();
    const client=this.s3(p),send=input=>client.send(input,{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(120000)])}),r2=p.provider==='r2',missing=error=>error.$metadata?.httpStatusCode===404||error.name==='NotFound'||error.name==='NoSuchKey';
    // R2 does not implement x-amz-checksum headers: writes carry Content-MD5, which R2 validates, and the resulting ETag is recorded for readback.
    if(f.size<=16*1024**2){f.remoteChecksum=r2?'"'+Buffer.from(f.md5,'base64').toString('hex')+'"':Buffer.from(f.sha256,'hex').toString('base64');await this.checkpoint();try{const h=await this.headS3(p,f,signal);if(this.validS3(h,f,p)){progress(f.size);return;}throw Error('Object name already exists with different content.');}catch(error){if(!missing(error))throw error;}
      try{await send(new PutObjectCommand({Bucket:p.bucket,Key:f.key,Body:fs.createReadStream(f.path),ContentLength:f.size,...(r2?{ContentMD5:f.md5}:{ChecksumSHA256:f.remoteChecksum}),Metadata:{'odm-sha256':f.sha256},IfNoneMatch:'*'}));}catch(error){if(error.$metadata?.httpStatusCode!==412)throw error;}
      await this.verify(p,f,signal);progress(f.size);return;
    }
    const partSize=Math.max(16*1024**2,Math.ceil(f.size/10000/(1024*1024))*1024*1024);if(partSize>64*1024**2)throw Error('This file exceeds the supported 640 GB multipart size.');
    const handle=await fsp.open(f.path,'r');try{
      if(!f.uploadId){try{await this.headS3(p,f,signal);if(f.remoteChecksum){await this.verify(p,f,signal);progress(f.size);return;}throw Error('An object already exists at the upload key.');}catch(error){if(!missing(error))throw error;}
        const response=await send(new CreateMultipartUploadCommand({Bucket:p.bucket,Key:f.key,...(r2?{}:{ChecksumAlgorithm:'SHA256',ChecksumType:'COMPOSITE'}),Metadata:{'odm-sha256':f.sha256}}));f.uploadId=response.UploadId;f.parts=[];f.remoteChecksum='';f.completing=false;await this.checkpoint();}
      let remote=[];try{let marker;do{const response=await send(new ListPartsCommand({Bucket:p.bucket,Key:f.key,UploadId:f.uploadId,PartNumberMarker:marker}));remote.push(...(response.Parts||[]));marker=response.IsTruncated?response.NextPartNumberMarker:undefined;}while(marker);}catch(error){if(error.name==='NoSuchUpload'||error.$metadata?.httpStatusCode===404){if(f.remoteChecksum||r2&&f.completing){try{await this.adoptCompleted(p,f,signal);await this.verify(p,f,signal);f.uploadId='';f.parts=[];f.completing=false;await this.checkpoint();progress(f.size);return;}catch{}}f.uploadId='';f.parts=[];f.remoteChecksum='';f.completing=false;await this.checkpoint();if(resets>=1)throw Error('Multipart session repeatedly disappeared. Retry after checking the destination.');return this.uploadS3(p,f,signal,progress,resets+1);}throw error;}
      const previous=f.parts||[],parts=[];for(let offset=0,n=1;offset<f.size;offset+=partSize,n++){signal.throwIfAborted();const length=Math.min(partSize,f.size-offset),data=Buffer.allocUnsafe(length);let received=0;while(received<length){const r=await handle.read(data,received,length-received,offset+received);if(!r.bytesRead)throw Error('Local file became truncated.');received+=r.bytesRead;}
        let part;if(r2){const md5=crypto.createHash('md5').update(data).digest('base64'),known=previous.find(v=>v.PartNumber===n&&v.md5===md5);part=known&&remote.find(v=>v.PartNumber===n&&v.ETag===known.ETag&&Number(v.Size)===length);if(!part){const r=await send(new UploadPartCommand({Bucket:p.bucket,Key:f.key,UploadId:f.uploadId,PartNumber:n,Body:data,ContentLength:length,ContentMD5:md5}));if(!r.ETag)throw Error('R2 did not acknowledge the uploaded part.');part={ETag:r.ETag};}parts.push({PartNumber:n,ETag:part.ETag,md5});}
        else{const checksum=crypto.createHash('sha256').update(data).digest('base64');part=remote.find(v=>v.PartNumber===n&&v.ChecksumSHA256===checksum);if(!part){const r=await send(new UploadPartCommand({Bucket:p.bucket,Key:f.key,UploadId:f.uploadId,PartNumber:n,Body:data,ContentLength:length,ChecksumSHA256:checksum}));if(r.ChecksumSHA256!==checksum)throw Error('S3 multipart checksum was not verified.');part={PartNumber:n,ETag:r.ETag,ChecksumSHA256:checksum};}parts.push({PartNumber:n,ETag:part.ETag,ChecksumSHA256:checksum});}
        f.parts=parts;await this.checkpoint();progress(offset+length);}
      if(r2){f.completing=true;await this.checkpoint();const response=await send(new CompleteMultipartUploadCommand({Bucket:p.bucket,Key:f.key,UploadId:f.uploadId,MultipartUpload:{Parts:parts.map(({PartNumber,ETag})=>({PartNumber,ETag}))}}));if(!response.ETag)throw Error('R2 did not return the completed object ETag.');f.remoteChecksum=response.ETag;await this.checkpoint();}
      else{f.remoteChecksum=crypto.createHash('sha256').update(Buffer.concat(parts.map(v=>Buffer.from(v.ChecksumSHA256,'base64')))).digest('base64')+'-'+parts.length;await this.checkpoint();
        try{await send(new CompleteMultipartUploadCommand({Bucket:p.bucket,Key:f.key,UploadId:f.uploadId,MultipartUpload:{Parts:parts},ChecksumType:'COMPOSITE',IfNoneMatch:'*'}));}catch(error){if(error.$metadata?.httpStatusCode!==412)throw error;}}
      await this.verify(p,f,signal);f.uploadId='';f.parts=[];f.completing=false;await this.checkpoint();
    }finally{await handle.close();}
  }
  // R2 completion can succeed before its ETag is checkpointed. The upload session is then gone, so the object is adopted only when
  // its size and the SHA-256 metadata written at multipart creation match; every part was already Content-MD5 validated by R2.
  async adoptCompleted(p,f,signal){if(p.provider!=='r2'||f.remoteChecksum)return;const h=await this.headS3(p,f,signal);if(Number(h.ContentLength)!==f.size||h.Metadata?.['odm-sha256']!==f.sha256||!h.ETag)throw Error('R2 object does not match the completed upload.');f.remoteChecksum=h.ETag;await this.checkpoint();}
  async uploadGCS(p,f,signal,progress){
    const file=this.gcs(p).bucket(p.bucket).file(f.key),vaultKey='gcs-upload:'+crypto.createHash('sha256').update(p.id+'|'+f.key).digest('hex'),fetcher=this.options.fetch||globalThis.fetch;
    try{await file.getMetadata();await this.verify(p,f,signal);progress(f.size);return;}catch(error){if(error.code!==404)throw error;}
    const validateURI=value=>{const u=new URL(value);if(u.username||u.password||!(u.protocol==='https:'&&/^(?:storage\.googleapis\.com|[a-z0-9.-]+\.storage\.googleapis\.com)$/.test(u.hostname)||this.options.gcsStorageFactory&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw Error('Invalid GCS upload session URL.');};
    let uri=this.engine.vault.get(vaultKey),offset=0;if(uri)validateURI(uri);
    if(uri){const response=await fetcher(uri,{method:'PUT',headers:{'Content-Length':'0','Content-Range':'bytes */'+f.size},signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});if(response.status===200||response.status===201){await this.verify(p,f,signal);await this.engine.vault.set(vaultKey,null);progress(f.size);return;}if(response.status===308){const range=/bytes=0-(\d+)/.exec(response.headers.get('range')||'');offset=range?Number(range[1])+1:0;}else if([404,410].includes(response.status))uri=null;else throw Error('GCS resume probe returned HTTP '+response.status);}
    if(!uri){[uri]=await file.createResumableUpload({metadata:{metadata:{odm_sha256:f.sha256},md5Hash:f.md5},preconditionOpts:{ifGenerationMatch:0}});validateURI(uri);await this.engine.vault.set(vaultKey,uri);}
    if(!Number.isSafeInteger(offset)||offset<0||offset>f.size||offset<f.size&&offset%(256*1024)!==0)throw Error('GCS returned an invalid upload offset.');
    if(f.size===0){const response=await fetcher(uri,{method:'PUT',headers:{'Content-Length':'0','Content-Range':'bytes */0'},signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});if(![200,201].includes(response.status))throw Error('GCS empty upload returned HTTP '+response.status);}
    const handle=await fsp.open(f.path,'r');try{while(offset<f.size){signal.throwIfAborted();const length=Math.min(8*1024**2,f.size-offset),chunk=Buffer.allocUnsafe(length);let received=0;while(received<length){const r=await handle.read(chunk,received,length-received,offset+received);if(!r.bytesRead)throw Error('Local file became truncated.');received+=r.bytesRead;}
        const response=await fetcher(uri,{method:'PUT',headers:{'Content-Length':String(length),'Content-Type':'application/octet-stream','Content-Range':'bytes '+offset+'-'+(offset+length-1)+'/'+f.size},body:chunk,signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});if(![200,201,308].includes(response.status))throw Error('GCS upload returned HTTP '+response.status);
        if(response.status===308){const range=/bytes=0-(\d+)/.exec(response.headers.get('range')||'');const accepted=range?Number(range[1])+1:0;if(accepted<=offset||accepted>offset+length)throw Error('GCS did not acknowledge the uploaded bytes.');offset=accepted;}else offset=f.size;progress(offset);}
    }finally{await handle.close();}
    await this.verify(p,f,signal);await this.engine.vault.set(vaultKey,null);
  }
  async close(){for(const c of this.clients.values())c.destroy?.();this.clients.clear();}
}
module.exports={CloudManager,profile,fingerprint,r2Endpoint,r2EnvCredentials};
