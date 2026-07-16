'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const rpc = require('./rpc');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#12100e',
    title: 'Shop Tycoon Console',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.setMenuBarVisibility(false);

  // External links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function broadcast(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('app-event', payload);
}

function loadFeatureModules(broadcastFn) {
  const modules = [
    ['./core/app-rpc'],
    ['./adapters'],
    ['./core/inbox'],
    ['./core/products'],
    ['./core/listings'],
    ['./core/orders'],
    ['./ai/assistant'],
    ['./core/game', (m) => m.init({ broadcast: broadcastFn })],
    ['./core/sync', (m) => m.start({ broadcast: broadcastFn })]
  ];
  for (const [name, setup] of modules) {
    let mod;
    try {
      mod = require(name);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND' && e.message.includes(name.replace('./', ''))) continue; // later build stage
      throw e;
    }
    if (setup) setup(mod);
  }
}

app.whenReady().then(() => {
  // Initialize storage first so every module below can use it.
  require('./db').get();

  // Feature modules register their RPC methods on load. Modules arrive in
  // build stages; a module that doesn't exist yet is skipped, but a module
  // that exists and fails to load crashes loudly (never silently).
  loadFeatureModules(broadcast);

  ipcMain.handle('rpc', (_event, method, params) => rpc.dispatch(method, params));
  ipcMain.handle('clipboard-write', (_event, text) => clipboard.writeText(String(text)));

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
