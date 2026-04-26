const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';

// Persistent store backed by a JSON file in userData
let _store = null;
function getStore() {
  if (_store) return _store;
  const dir = app.getPath('userData');
  const file = path.join(dir, 'electron-settings.json');
  let data = { port: 3000 };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  _store = {
    file,
    data,
    get: (key) => _store.data[key] ?? (key === 'port' ? 3000 : undefined),
    set: (key, value) => {
      _store.data[key] = value;
      fs.writeFileSync(_store.file, JSON.stringify(_store.data, null, 2));
    },
  };
  return _store;
}

let mainWindow = null;
let botInstance = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'control.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

function getPlatformStatus() {
  if (botInstance && typeof botInstance.getPlatformStatus === 'function') {
    return botInstance.getPlatformStatus();
  }
  return { platforms: {}, port: getStore().get('port') };
}

function setupIpcHandlers() {
  ipcMain.handle('get-status', () => getPlatformStatus());

  ipcMain.handle('start-platform', (_event, name) => {
    if (botInstance && typeof botInstance.startPlatform === 'function') {
      botInstance.startPlatform(name);
      return { ok: true };
    }
    return { error: 'Bot not ready' };
  });

  ipcMain.handle('stop-platform', (_event, name) => {
    if (botInstance && typeof botInstance.stopPlatform === 'function') {
      botInstance.stopPlatform(name);
      return { ok: true };
    }
    return { error: 'Bot not ready' };
  });

  ipcMain.handle('open-dashboard', () => {
    shell.openExternal(`http://localhost:${getStore().get('port')}`);
    return { ok: true };
  });

  ipcMain.handle('get-port', () => getStore().get('port'));

  ipcMain.handle('set-port', (_event, port) => {
    const portNum = parseInt(port, 10);
    if (portNum < 1024 || portNum > 65535) {
      return { error: 'Port must be between 1024 and 65535' };
    }
    getStore().set('port', portNum);
    return { ok: true, port: portNum, needsRestart: true };
  });
}

// Single instance lock (must be before app.on('ready'))
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('ready', () => {
  const store = getStore();

  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.PORT = store.get('port');

  createWindow();
  setupIpcHandlers();

  setImmediate(() => {
    try {
      delete require.cache[require.resolve('../bot')];
      const botModule = require('../bot');
      botInstance = botModule;
      botModule.start().catch((err) => {
        console.error('Bot startup error:', err.message);
      });
    } catch (err) {
      console.error('Failed to load/start bot:', err.message);
    }
  });
});

app.on('before-quit', () => {
  if (botInstance && typeof botInstance.shutdown === 'function') {
    try { botInstance.shutdown('app-quit'); } catch (_) {}
  }
});
