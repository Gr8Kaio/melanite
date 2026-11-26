// Preload: expone solo lo necesario. El acceso al disco se limita a la carpeta del vault (ver folder.cjs).
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, value) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('melaniteDesktop', {
  platform: process.platform,
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onProgress: on('update:progress'),
    onDownloaded: on('update:downloaded'),
  },
  folder: {
    get: () => ipcRenderer.invoke('folder:get'),
    choose: () => ipcRenderer.invoke('folder:choose'),
    clear: () => ipcRenderer.invoke('folder:clear'),
    reveal: () => ipcRenderer.invoke('folder:reveal'),
    list: () => ipcRenderer.invoke('folder:list'),
    stat: (rel) => ipcRenderer.invoke('folder:stat', rel),
    read: (rel) => ipcRenderer.invoke('folder:read', rel),
    write: (rel, data) => ipcRenderer.invoke('folder:write', rel, data),
    mkdir: (rel) => ipcRenderer.invoke('folder:mkdir', rel),
    rename: (from, to) => ipcRenderer.invoke('folder:rename', from, to),
    delete: (rel) => ipcRenderer.invoke('folder:delete', rel),
    onChanged: (cb) => {
      const listener = (_e, rel) => cb(rel);
      ipcRenderer.on('folder:changed', listener);
      return () => ipcRenderer.removeListener('folder:changed', listener);
    },
  },
});
