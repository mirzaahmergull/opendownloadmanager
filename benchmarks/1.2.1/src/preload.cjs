const { contextBridge, ipcRenderer } = require('electron');
const calls = ['snapshot', 'add', 'add-batch', 'resume-many', 'pause-many', 'remove-many', 'pause', 'resume', 'remove', 'pause-all', 'clear-completed', 'update-job', 'settings', 'queue', 'queue-start', 'queue-stop', 'move-job', 'category', 'remove-category', 'read-clipboard', 'choose-folder', 'open-file', 'show-file', 'video-info', 'grab', 'integration', 'copy', 'extension-folder', 'export', 'import', 'exit'];
calls.push('collect','check-links','remove-links','start-links','rules','collection-info','collection-add','subscription','subscription-check','traffic','archive-list','archive-extract','convert-media','crawl','torrent-info','torrent-add','choose-torrent');
calls.push('remote-zip-info','remote-zip-extract','appearance','cancel-inspection');
contextBridge.exposeInMainWorld('odm', {
  platform:process.platform,
  invoke: async (name, ...args) => {
    if (!calls.includes(name)) throw new Error('Unknown command.');
    const result = await ipcRenderer.invoke(name, ...args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  on: (channel, callback) => {
    if (!['state', 'progress', 'command', 'browser-added', 'clipboard-url'].includes(channel)) return;
    const listener = (_, value) => callback(value); ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
