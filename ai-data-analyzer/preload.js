const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getMCPStatus: () => ipcRenderer.invoke('get-mcp-status'),
  restartMCPServer: () => ipcRenderer.invoke('restart-mcp-server')
});