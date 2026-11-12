'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('UADesktop', {
  isDesktop: true,
  exportFile: (kind, content, suggested) => ipcRenderer.invoke('export-file', { kind, content, suggested }),
  scanUnity: (opts) => ipcRenderer.invoke('scan-unity', opts),
  loadDemo: () => ipcRenderer.invoke('load-demo'),
  setTitle: (title) => ipcRenderer.send('set-title', title),
  quit: () => ipcRenderer.send('app-quit'),
  onMenu: (cb) => ipcRenderer.on('menu-action', (_e, action, payload) => cb(action, payload))
});
