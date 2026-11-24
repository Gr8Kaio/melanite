// Preload mínimo: la app web no necesita nada del proceso principal.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('melaniteDesktop', { platform: process.platform });
