const yauzl=require('yauzl');
const {Readable}=require('node:stream');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {probe,request,webURL}=require('./net.cjs');
const {listZIP,extractZIP}=require('./advanced.cjs');
class HTTPReader extends yauzl.RandomAccessReader {
  constructor(url,meta,proxy){super();this.url=url;this.meta=meta;this.proxy=proxy;this.abort=new AbortController();this.bytesRead=0;}
  _readStreamForRange(start,end){
    const self=this;
    return Readable.from((async function*(){
      const validator=self.meta.etag && !/^W\//.test(self.meta.etag)?self.meta.etag:self.meta.modified;
      const response=await request(self.url,{signal:AbortSignal.any([self.abort.signal,AbortSignal.timeout(30000)]),proxy:self.proxy,headers:{Range:`bytes=${start}-${end-1}`,'If-Range':validator}});
      const expected=`bytes ${start}-${end-1}/${self.meta.size}`;
      if(response.statusCode!==206 || response.headers['content-range']!==expected || self.meta.etag && response.headers.etag!==self.meta.etag || !self.meta.etag && response.headers['last-modified']!==self.meta.modified){response.destroy();throw Error('Remote ZIP changed or returned an invalid byte range.');}
      let received=0;
      for await(const chunk of response){received+=chunk.length;self.bytesRead+=chunk.length;if(received>end-start){response.destroy();throw Error('Remote ZIP range contained extra bytes.');}yield chunk;}
      if(received!==end-start)throw Error('Remote ZIP range was truncated.');
    })());
  }
  close(callback){this.abort.abort();setImmediate(callback);}
}
async function inspect(engine,url){
  webURL(url);const meta=await probe(url,{},AbortSignal.timeout(20000),engine.settings.proxyURL);
  if(!meta.resumable || !Number.isSafeInteger(meta.size) || !(meta.etag && !/^W\//.test(meta.etag) || meta.modified))throw Error('Remote ZIP selection requires byte ranges, a known size and a stable server validator. Download the full archive instead.');
  const reader=new HTTPReader(url,meta,engine.settings.proxyURL);const entries=await listZIP({reader,size:meta.size});
  const id=crypto.randomUUID();engine.remoteArchives ||= new Map();if(engine.remoteArchives.size>=5)engine.remoteArchives.delete(engine.remoteArchives.keys().next().value);
  const session={id,url,meta,entries,filename:engine.filenameFrom(url,meta.disposition),createdAt:Date.now()};engine.remoteArchives.set(id,session);
  return {id,entries,size:meta.size,metadataBytes:reader.bytesRead,filename:session.filename};
}
async function extract(engine,id,selected,directory){
  const session=engine.remoteArchives?.get(id);if(!session || Date.now()-session.createdAt>30*60000)throw Error('Remote ZIP inspection expired. Inspect the address again.');
  if(!Array.isArray(selected)||!selected.length||selected.some(n=>!session.entries.some(e=>e.name===n)))throw Error('Select valid remote archive files.');
  const root=directory || engine.settings.downloadDir;if(!path.isAbsolute(root))throw Error('Choose an absolute extraction folder.');
  const stem=engine.safeName(session.filename.replace(/\.zip$/i,''))+' - selected';let output=path.join(root,stem),n=1;while(fs.existsSync(output))output=path.join(root,stem+` (${n++})`);
  await require('node:fs/promises').mkdir(root,{recursive:true});
  const reader=new HTTPReader(session.url,session.meta,engine.settings.proxyURL);
  const files=await extractZIP({reader,size:session.meta.size},output,selected);return {destination:output,files,transferred:reader.bytesRead,archiveSize:session.meta.size};
}
module.exports={HTTPReader,inspect,extract};
