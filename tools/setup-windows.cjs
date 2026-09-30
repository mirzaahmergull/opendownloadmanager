// Fetch pinned upstream tools for contributors and Windows CI; binaries stay ignored.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const FFMPEG={url:'https://github.com/GyanD/codexffmpeg/releases/download/9.0/ffmpeg-9.0-full_build.zip',sha256:'f42f0c4b04eae3ac918707ff66e3e0ff0cee527bfa6d322624d4bc1160d5055e'};
async function download(url,target,expected){const r=await fetch(url,{signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error(`Download failed (${r.status}): ${url}`);const bytes=Buffer.from(await r.arrayBuffer());if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Checksum mismatch: '+url);await fs.writeFile(target,bytes);}
(async()=>{if(process.platform!=='win32')throw Error('Use npm run setup:mac on macOS.');const root=path.resolve(__dirname,'..'),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'odm-tools-'));try{
 const tools=path.join(root,'tools'),base='https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/';
 const r=await fetch(base+'SHA2-256SUMS');if(!r.ok)throw Error('yt-dlp checksums unavailable');const sums=await r.text(),sha=sums.split('\n').find(s=>/\s+yt-dlp\.exe$/.test(s))?.split(/\s+/)[0];if(!sha)throw Error('yt-dlp checksum absent');
 await download(base+'yt-dlp.exe',path.join(tools,'yt-dlp.exe'),sha);await fs.writeFile(path.join(tools,'yt-dlp-SHA2-256SUMS.txt'),sums);
 const archive=path.join(tmp,'ffmpeg.zip');await download(FFMPEG.url,archive,FFMPEG.sha256);
 const unzip=spawnSync(require('7zip-bin').path7za,['x','-y',archive,'-o'+tmp],{windowsHide:true,encoding:'utf8'});if(unzip.status!==0)throw Error(unzip.stderr+unzip.stdout);
 const folder=(await fs.readdir(tmp,{withFileTypes:true})).find(e=>e.isDirectory()&&e.name.startsWith('ffmpeg-'));if(!folder)throw Error('FFmpeg archive layout changed');const ff=path.join(tmp,folder.name);
 for(const name of ['ffmpeg','ffprobe'])await fs.copyFile(path.join(ff,'bin',name+'.exe'),path.join(tools,name+'.exe'));
 await fs.mkdir(path.join(tools,'licenses'),{recursive:true});for(const [name,target]of [['LICENSE','FFmpeg-LICENSE.txt'],['README.txt','FFmpeg-README.txt']])await fs.copyFile(path.join(ff,name),path.join(tools,'licenses',target));
 const setup=spawnSync(process.execPath,[path.join(tools,'setup-archive.cjs')],{stdio:'inherit',windowsHide:true});if(setup.status!==0)throw Error('7-Zip setup failed');
 console.log('Verified pinned Windows yt-dlp, FFmpeg/FFprobe and 7-Zip.');
 }finally{await fs.rm(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
