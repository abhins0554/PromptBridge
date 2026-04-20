const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bot', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  startPlatform: (name) => ipcRenderer.invoke('start-platform', name),
  stopPlatform: (name) => ipcRenderer.invoke('stop-platform', name),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),
  getPort: () => ipcRenderer.invoke('get-port'),
  setPort: (port) => ipcRenderer.invoke('set-port', port),
});
