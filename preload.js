const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openDialog: () => ipcRenderer.invoke('file:open'),
  readPath: (p) => ipcRenderer.invoke('file:read', p),
  save: (content) => ipcRenderer.invoke('file:save', content),
  saveAs: (content) => ipcRenderer.invoke('file:save-as', content),
  newDoc: () => ipcRenderer.invoke('file:new'),
  confirmDiscard: () => ipcRenderer.invoke('doc:confirm-discard'),
  setState: (state) => ipcRenderer.send('doc:state', state),
  closeNow: () => ipcRenderer.send('win:close-now'),
  setTheme: (dark) => ipcRenderer.send('ui:theme', dark),
  openExternal: (url) => ipcRenderer.send('shell:open', url),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action, payload) => cb(action, payload)),
});
