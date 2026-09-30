const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Tray, Menu, Notification, nativeImage, safeStorage, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Engine } = require('./engine.cjs');
const { createBridge, grabLinks } = require('./bridge.cjs');

let win, engine, bridge, tray, quitting = false, shutdown = false, clipboardTimer;
let extensionPath;
if (process.env.ODM_TEST_DATA) app.setPath('userData', process.env.ODM_TEST_DATA);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('activate',()=>{win?.show();win?.focus();});
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(async () => {
    const toolsDir = app.isPackaged ? path.join(process.resourcesPath, 'tools') : require('./platform.cjs').developmentTools(path.join(__dirname, '..'));
    extensionPath = app.isPackaged ? path.join(app.getPath('userData'), 'browser-extension') : path.join(__dirname, '..', 'extension');
    if (app.isPackaged) { fs.mkdirSync(extensionPath, { recursive: true }); fs.cpSync(path.join(process.resourcesPath, 'extension'), extensionPath, { recursive: true }); }
    const encryption = safeStorage.isEncryptionAvailable() ? { encryptSecret: text => safeStorage.encryptString(text).toString('base64'), decryptSecret: blob => safeStorage.decryptString(Buffer.from(blob, 'base64')) } : {};
    engine = new Engine({ dataDir: app.getPath('userData'), downloadDir: path.join(app.getPath('downloads'), 'Open Download Manager'), toolsDir, ffmpegPath: require('./platform.cjs').toolPaths(toolsDir).ffmpeg, nodePath: process.execPath, asynchronousPersistence:true, ...encryption });
    const iconPath = path.join(__dirname, '..', 'assets', 'app.png');
    win = new BrowserWindow({ width: 1280, height: 840, minWidth: 820, minHeight: 600, titleBarStyle: process.platform==='darwin'?'hiddenInset':'hidden', ...(process.platform==='win32'?{titleBarOverlay:{color:'#f6f8fa',symbolColor:'#243047',height:44}}:{}), title: 'Open Download Manager', icon: iconPath, show: false, backgroundColor: '#f6f8fa', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Open Download Manager',submenu:[{role:'about'},{type:'separator'},{label:'Settings…',accelerator:'Cmd+,',click:()=>win?.webContents.send('command','options')},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{label:'File',submenu:[{label:'New Download',accelerator:'Cmd+N',click:()=>win?.webContents.send('command','add')},{label:'Playlist / Video',click:()=>win?.webContents.send('command','library')},{role:'close'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));else Menu.setApplicationMenu(null);
    win.loadFile(path.join(__dirname, 'index.html'));
    win.once('ready-to-show', () => win.show());
    win.on('close', event => { if (!quitting && engine.settings.minimizeToTray && tray) { event.preventDefault(); win.hide(); } });
    win.on('closed', () => { win = null; if (!quitting) app.quit(); });
    const icon = nativeImage.createFromPath(iconPath);
    const trayImage=process.platform==='darwin'?nativeImage.createFromPath(path.join(__dirname,'../assets/trayTemplate.png')).resize({width:18,height:18}):icon.resize({width:16,height:16});if(process.platform==='darwin')trayImage.setTemplateImage(true);tray = new Tray(trayImage);
    tray.setToolTip('Open Download Manager');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Download Manager', click: () => win?.show() },
      { label: 'Add URL…', click: () => { win?.show(); win?.webContents.send('command', 'add'); } },
      { label: 'Stop all downloads', click: () => engine.pauseAll() },
      { type: 'separator' }, { label: 'Exit', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('double-click', () => win?.show());
    bridge = createBridge(engine, { port: process.env.ODM_TEST_PORT ? Number(process.env.ODM_TEST_PORT) : 17843, onAdd: job => { win?.webContents.send('browser-added', job); } });
    try { await bridge.listen(); } catch (error) { engine.loadWarning = `Browser bridge unavailable: ${error.message}`; }
    engine.on('change', state => { if (win && !win.isDestroyed()) win.webContents.send('state', state); });
    engine.on('progress',jobs=>{if(win&&!win.isDestroyed())win.webContents.send('progress',jobs);});
    const notificationGate=new (require('./notifications.cjs').NotificationGate)(notice=>{if(!process.env.ODM_TEST_DATA&&Notification.isSupported())try{new Notification({title:notice.title,body:notice.message,icon:iconPath}).show();}catch{}},{mode:()=>engine.settings.notificationMode});
    engine.on('complete',job=>notificationGate.send('complete',{title:job.cloud?'Download archived to cloud':'Download complete',message:job.filename,jobId:job.id}));
    engine.on('job-error',job=>notificationGate.send('error',{title:'Download needs attention',message:job.filename+': '+job.error,jobId:job.id}));
    engine.on('attention',notice=>notificationGate.send('attention',notice));
    if(!process.env.ODM_TEST_DATA){engine.initialUpdateTimer=setTimeout(()=>engine.updater.poll(),30000);engine.updateTimer=setInterval(()=>engine.updater.poll(),60000);}

    let lastClip = clipboard.readText();
    clipboardTimer = setInterval(() => {
      if (!engine.settings.clipboard || !win) return;
      const text = clipboard.readText().trim();
      if (text !== lastClip && /^https?:\/\/\S+\.(zip|exe|msi|pdf|7z|mp4|mp3)(?:\?\S*)?$/i.test(text)) { win.show(); win.webContents.send('clipboard-url', text); }
      lastClip = text;
    }, 1500);
    function handler(name, callback) {
      ipcMain.handle(name, async (event, ...args) => {
        if (event.sender !== win?.webContents) throw new Error('Unauthorized renderer.');
        if (engine.closing && name !== 'snapshot' && name !== 'exit') return { ok: false, error: 'The application is shutting down. Reopen it before starting another operation.' };
        try { return { ok: true, value: await callback(...args) }; } catch (error) { return { ok: false, error: error.message }; }
      });
    }
    const inspections=new Map();async function inspect(id,work){if(!id)return work();if(typeof id!=='string'||id.length>80)throw Error('Invalid inspection.');if(inspections.size>=4)throw Error('Close another inspection before starting a new one.');const controller=new AbortController();inspections.set(id,controller);try{return await work(controller.signal);}finally{inspections.delete(id);}}
    handler('cancel-inspection',id=>{inspections.get(id)?.abort();});
    handler('snapshot', () => engine.snapshot());
    handler('appearance', theme=>{if(!['system','light','dark'].includes(theme))throw Error('Unknown appearance.');nativeTheme.themeSource=theme;if(process.platform==='win32')win.setTitleBarOverlay({color:nativeTheme.shouldUseDarkColors?'#101720':'#f6f8fa',symbolColor:nativeTheme.shouldUseDarkColors?'#e5edf5':'#243047'});return theme;});
    handler('add', input => engine.add(input));
    handler('resume-many', ids => engine.resumeMany(ids));
    handler('pause-many', ids => engine.pauseMany(ids));
    handler('remove-many', ids => engine.removeMany(ids));
    handler('add-batch', (urls, start = true) => {
      if (!Array.isArray(urls) || !urls.length || urls.length > 200) throw Error('Choose between 1 and 200 URLs.');
      for (const url of urls) { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw Error('Only HTTP and HTTPS URLs are supported.'); }
      return engine.batch(() => urls.map(url => engine.add({ url, start })));
    });
    handler('pause', id => engine.pause(id));
    handler('resume', id => engine.resume(id));
    handler('remove', id => engine.remove(id));
    handler('pause-all', () => engine.pauseAll());
    handler('clear-completed', () => engine.clearCompleted());
    handler('update-job', (id, value) => engine.updateJob(id, value));
    handler('settings', value => { const result = engine.updateSettings(value); if (!process.env.ODM_TEST_DATA) app.setLoginItemSettings({ openAtLogin: !!result.startAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath }); return result; });
    handler('queue', value => engine.setQueue(value));
    handler('queue-start', name => engine.startQueue(name));
    handler('queue-stop', name => engine.stopQueue(name));
    handler('move-job', (id, direction) => engine.moveJob(id, direction));
    handler('category', value => engine.setCategory(value));
    handler('remove-category', name => engine.removeCategory(name));
    handler('read-clipboard', () => clipboard.readText());
    handler('choose-folder', async () => { const result = await dialog.showOpenDialog(win, { title: 'Choose download folder', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
    handler('open-file', id => { const j = engine.get(id); if (j.status !== 'complete' || !fs.existsSync(j.output)) throw new Error('The downloaded file does not exist.'); return shell.openPath(j.output); });
    handler('show-file', id => { const j = engine.get(id); if (j.output && fs.existsSync(j.output)) shell.showItemInFolder(j.output); else shell.openPath(j.directory); });
    handler('video-info', (url,id) => inspect(id,signal=>engine.inspectVideo(url,signal)));
    handler('grab', url => grabLinks(url));
    handler('collect', (text, name) => engine.collect(text, name));
    handler('check-links', ids => engine.checkLinks(ids));
    handler('remove-links', ids => engine.removeLinks(ids));
    handler('start-links', (ids, options) => engine.startLinks(ids, options));
    handler('rules', rules => engine.setRules(rules));
    handler('collection-info', (url,limit,id) => inspect(id,signal=>engine.inspectCollection(url,limit,signal)));
    handler('collection-add', input => engine.addCollection(input));
    handler('batch-create',input=>engine.batchManager.create(input));
    handler('batch-status',()=>({batches:engine.batchManager.summary(),video:engine.mediaPolicy.info(),cloudProfiles:engine.cloudManager.profiles(),update:engine.updater.info()}));
    handler('batch-control',(id,action,playlistId)=>engine.batchManager.control(id,action,playlistId));
    handler('video-control',action=>engine.mediaPolicy.control(action));
    handler('session-info',()=>engine.mediaPolicy.info().session);
    handler('session-forget',()=>engine.mediaPolicy.forget());
    handler('session-request',async()=>{const request=engine.mediaPolicy.request();const url='http://127.0.0.1:'+bridge.server.address().port+'/session-connect?request='+request.id;if(!process.env.ODM_TEST_DATA)await shell.openExternal(url);return {requestId:request.id,url,expires:request.expires};});
    handler('engine-update',()=>engine.updater.check());
    handler('engine-rollback',()=>engine.updater.rollback());
    handler('cloud-configure',input=>engine.cloudManager.configure(input));
    handler('cloud-remove',id=>engine.cloudManager.remove(id));
    handler('cloud-test',id=>engine.cloudManager.test(id));
    handler('cloud-google-key',async input=>{const result=await dialog.showOpenDialog(win,{title:'Choose Google service-account JSON',filters:[{name:'JSON key',extensions:['json']}],properties:['openFile']});if(result.canceled)return null;const file=result.filePaths[0];if(fs.statSync(file).size>256*1024)throw Error('Key file exceeds 256 KB.');return engine.cloudManager.configure({...input,provider:'gcs',credentials:JSON.parse(fs.readFileSync(file,'utf8'))});});

    handler('subscription', input => engine.setSubscription(input));
    handler('subscription-check', id => engine.checkSubscription(id));
    handler('traffic', (mode, limit) => engine.setTraffic(mode, limit));
    handler('archive-list', (id, password) => engine.archiveList(id,password));
    handler('archive-extract', (id, names, password) => engine.archiveExtract(id, names,password));
    handler('convert-media', (id, format) => engine.convertMedia(id, format));
    handler('crawl', input => engine.crawl(input));
    handler('torrent-info', input => engine.inspectTorrent(input));
    handler('torrent-add', input => engine.addTorrent(input));
    handler('remote-zip-info', url => require('./remote-zip.cjs').inspect(engine,url));
    handler('remote-zip-extract', (id, names, directory) => require('./remote-zip.cjs').extract(engine,id,names,directory));
    handler('choose-torrent', async () => { const result = await dialog.showOpenDialog(win, { title: 'Open torrent metadata', filters: [{ name: 'BitTorrent metadata', extensions: ['torrent'] }], properties: ['openFile'] }); if(result.canceled) return null; const file=result.filePaths[0];if(fs.statSync(file).size>4*1024**2) throw Error('Torrent metadata exceeds 4 MB.');return { data:fs.readFileSync(file).toString('base64'),filename:path.basename(file) }; });
    handler('integration', () => ({ token: engine.token, port: bridge.server.address()?.port || 17843, extensionPath, connected: Date.now() - bridge.extensionLastSeen < 60000 }));
    handler('copy', text => clipboard.writeText(String(text)));
    handler('extension-folder', () => shell.openPath(extensionPath));
    handler('export', async () => {
      const result = await dialog.showSaveDialog(win, { defaultPath: 'downloads.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!result.canceled) fs.writeFileSync(result.filePath, JSON.stringify(engine.jobs.map(j => ({ url: j.url, filename: j.filename, description: j.description, type: j.type, category: j.category, format: j.format, media:j.media, playlistItem:j.playlistItem, package:j.package, mirrors:j.mirrors, expectedChecksum:j.expectedChecksum, ...(j.type === 'torrent' ? {data:j.torrentData,selection:j.torrentSelection,name:j.filename} : {}) })), null, 2));
      return !result.canceled;
    });
    handler('import', async () => {
      const result = await dialog.showOpenDialog(win, { filters: [{ name: 'Download list', extensions: ['json', 'txt'] }], properties: ['openFile'] });
      if (result.canceled) return 0;
      const file = result.filePaths[0]; if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('Import file exceeds 4 MB.');
      const text = fs.readFileSync(file, 'utf8');
      const items = file.endsWith('.json') ? JSON.parse(text) : text.split(/\r?\n/).map(url => ({ url: url.trim() })).filter(j => j.url);
      if (!Array.isArray(items) || items.length > 1000) throw new Error('Import up to 1,000 downloads at once.');
      engine.batch(() => { for (const input of items) input.type === 'torrent' ? engine.addTorrent({ ...input, start: false }) : engine.add({ ...input, start: false }); }); return items.length;
    });
    handler('exit', () => { quitting = true; app.quit(); });
  }).catch(error => { dialog.showErrorBox('Open Download Manager could not start', error.stack || error.message); app.quit(); });
}
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('before-quit', event => {
  quitting = true;
  if (!shutdown && engine) {
    event.preventDefault(); shutdown = true; clearInterval(clipboardTimer);
    Promise.all([engine.close(), bridge?.close()]).finally(() => { tray?.destroy(); app.quit(); });
  }
});
