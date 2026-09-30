const { _electron:electron }=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'odm-stale-ui-'));let app;try{
 const env={...process.env,ODM_TEST_DATA:dir,ODM_TEST_PORT:'0'};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({...(process.env.ODM_TEST_EXE?{executablePath:process.env.ODM_TEST_EXE,args:[]}:{args:[path.resolve(__dirname,'..')]}),env});const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#empty-state');
 await app.evaluate(({ipcMain})=>{global.odmDelayed={};for(const name of ['archive-list','torrent-info','crawl']){ipcMain.removeHandler(name);ipcMain.handle(name,()=>new Promise(resolve=>{global.odmDelayed[name]=resolve;}));}});
 await page.evaluate(()=>{currentJob=()=>({id:'fixture',filename:'fixture.zip'});});
 // Start, close and replace the dialog while its operation is still unresolved.
 for(const scenario of ['archive','torrent','grabber']){
   await page.evaluate(s=>{actions[s]();},scenario);const channel=scenario==='archive'?'archive-list':scenario==='torrent'?'torrent-info':'crawl';
   if(scenario==='torrent'){await page.fill('#torrent-url','https://example.org/file.torrent');await page.click('#torrent-inspect');}
   if(scenario==='grabber'){await page.fill('#crawl-url','https://example.org/');await page.click('#crawl-scan');}
   await app.evaluate((_,name)=>{global.odmOldResolve=global.odmDelayed[name];},channel);
   await page.click('#dialog-close');await page.evaluate(s=>{actions[s]();},scenario);
   await app.evaluate((_,s)=>global.odmOldResolve(s==='archive'?[{name:'STALE.txt',size:1}]:s==='torrent'?{name:'STALE',infoHash:'fixture',files:[{index:0,name:'STALE.txt',size:1}]}:{links:[{url:'https://example.org/STALE.zip',filename:'STALE'}],pages:1,errors:[]}),scenario);
   // Wait for an event-loop round trip after the IPC reply, with no fixed timing assumptions.
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.equal(await page.locator('#dialog').textContent().then(s=>s.includes('STALE')),false,scenario+' received stale results');await page.click('#dialog-close');
 }
 assert.deepEqual(errors,[]);console.log('PASS iteration 23: delayed archive, torrent and crawler results cannot modify a replacement dialog; no renderer errors.');
 }finally{await app?.close();await fs.rm(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
