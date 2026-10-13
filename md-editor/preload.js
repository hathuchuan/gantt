const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readPath: (p) => ipcRenderer.invoke('file:read', p),
  save: (content) => ipcRenderer.invoke('file:save', content),
  saveAs: (content) => ipcRenderer.invoke('file:save-as', content),
  confirmDiscard: () => ipcRenderer.invoke('doc:confirm-discard'),
  setState: (state) => ipcRenderer.send('doc:state', state),
  closeNow: () => ipcRenderer.send('win:close-now'),
  setTheme: (dark) => ipcRenderer.send('ui:theme', dark),
  openExternal: (url) => ipcRenderer.send('shell:open', url),
  pathForFile: (file) => webUtils.getPathForFile(file),
  loadCommands: () => ipcRenderer.invoke('commands:load'),
  setDisabledCommands: (keys) => ipcRenderer.invoke('commands:set-disabled', keys),
  openCommandsFile: () => ipcRenderer.invoke('commands:open-file'),
  ganttBlocks: () => ipcRenderer.invoke('gantt:blocks'),
  ganttOpen: (block) => ipcRenderer.invoke('gantt:open', block),
  ganttLink: (info) => ipcRenderer.invoke('gantt:link', info),
  ganttUnlink: (block) => ipcRenderer.invoke('gantt:unlink', block),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action, payload) => cb(action, payload)),
});
