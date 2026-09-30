const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
async function fetchFile(url,destination,expected){const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error(`${r.status}: ${url}`);const bytes=Buffer.from(await r.arrayBuffer());const sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(expected && sha256!==expected.replace('sha256:',''))throw Error('Checksum mismatch: '+url);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);return {url,sha256,bytes:bytes.length};}
async function release(repo,version){const r=await fetch(`https://api.github.com/repos/${repo}/releases/tags/${version}`);if(!r.ok)throw Error('Release metadata unavailable');return r.json();}
(async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'odm-mac-tools-'));const base=path.join(root,'tools-macos');
 const yt='https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/';const sums=await fetch(yt+'SHA2-256SUMS').then(r=>r.text());const expected=sums.split('\n').find(s=>/\syt-dlp_macos$/.test(s))?.split(/\s+/)[0];if(!expected)throw Error('yt-dlp Mac checksum absent');const ytdlp=await fetchFile(yt+'yt-dlp_macos',path.join(tmp,'yt-dlp'),expected);
 const ff=await release('eugeneware/ffmpeg-static','b6.1.1');const seven=await release('ip7z/7zip','26.03');const asset=seven.assets.find(a=>a.name==='7z2603-mac.tar.xz');const sevenSource=await fetchFile(asset.browser_download_url,path.join(tmp,asset.name),asset.digest);
 if(process.platform==='win32'){const binary=require('7zip-bin').path7za;for(const file of [path.join(tmp,asset.name),path.join(tmp,'7z2603-mac.tar')]){const r=spawnSync(binary,['x','-y',file,'-o'+tmp],{windowsHide:true,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr+r.stdout);}}else{const r=spawnSync('tar',['-xf',path.join(tmp,asset.name),'-C',tmp],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);}
 for(const arch of ['arm64','x64']){
  const dir=path.join(base,arch);await fs.mkdir(path.join(dir,'licenses'),{recursive:true});const manifest={arch,yt_dlp:{version:'2026.08.19',...ytdlp},seven_zip:{version:'26.03',...sevenSource},ffmpeg:{version:'6.1.1',files:[]}};
  await fs.copyFile(path.join(tmp,'yt-dlp'),path.join(dir,'yt-dlp'));await fs.copyFile(path.join(tmp,'7zz'),path.join(dir,'7zz'));
  for(const name of ['ffmpeg','ffprobe']){const a=ff.assets.find(a=>a.name===`${name}-darwin-${arch}`);if(!a?.digest)throw Error('Verified media asset absent');manifest.ffmpeg.files.push(await fetchFile(a.browser_download_url,path.join(dir,name),a.digest));await fs.chmod(path.join(dir,name),0o755);}
  for(const name of ['LICENSE','README']){const a=ff.assets.find(a=>a.name===`darwin-${arch}.${name}`);await fetchFile(a.browser_download_url,path.join(dir,'licenses','FFmpeg-'+name+'.txt'),a.digest);}
  await fs.copyFile(path.join(root,'tools/licenses/7zip.txt'),path.join(dir,'licenses/7zip.txt'));await fs.copyFile(path.join(root,'tools/licenses/yt-dlp-LICENSE.txt'),path.join(dir,'licenses/yt-dlp-LICENSE.txt')).catch(()=>{});
  for(const name of ['yt-dlp','7zz'])await fs.chmod(path.join(dir,name),0o755);
  await fs.writeFile(path.join(dir,'licenses/sources.json'),JSON.stringify(manifest,null,2));console.log(`Verified Mac ${arch}: yt-dlp, FFmpeg, FFprobe and 7-Zip`);
 }
 await fs.rm(tmp,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1;});
