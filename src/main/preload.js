'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (method, params) => ipcRenderer.invoke('rpc', method, params),
  // clipboard module isn't available in sandboxed preloads — main handles it
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard-write', String(text)),
  onEvent: (handler) => {
    ipcRenderer.on('app-event', (_e, payload) => handler(payload));
  }
});
