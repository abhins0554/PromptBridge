const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const Store = require('electron-store');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

const store = new Store({
  defaults: { port: 3000 },
});

let mainWindow = null;
let trayIcon = null;
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
  });

  return mainWindow;
}

function createTray() {
  const { Tray } = require('electron');
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

  trayIcon = new Tray(iconPath);

  function updateTrayMenu() {
    const status = getPlatformStatus();
    const runningCount = Object.values(status.platforms || {}).filter((p) => p.running).length;
    const isRunning = runningCount > 0;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `PromptBridge — ${isRunning ? `Running (${runningCount})` : 'Stopped'} on :${store.get('port')}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: () => {
          shell.openExternal(`http://localhost:${store.get('port')}`);
        },
      },
      { type: 'separator' },
      {
        label: isRunning ? 'Stop All Services' : 'Start All Services',
        click: () => {
          if (isRunning) {
            stopAllPlatforms();
          } else {
            startAllPlatforms();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        },
      },
    ]);

    trayIcon.setContextMenu(contextMenu);
  }

  updateTrayMenu();

  // Update tray menu every 2 seconds
  setInterval(updateTrayMenu, 2000);

  trayIcon.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createWindow();
    }
  });
}

function getPlatformStatus() {
  if (botInstance && typeof botInstance.getPlatformStatus === 'function') {
    return botInstance.getPlatformStatus();
  }
  return { platforms: {}, port: store.get('port') };
}

function startAllPlatforms() {
  if (botInstance && typeof botInstance.startPlatform === 'function') {
    ['telegram', 'discord', 'slack', 'teams', 'email', 'github'].forEach((name) => {
      botInstance.startPlatform(name);
    });
  }
}

function stopAllPlatforms() {
  if (botInstance && typeof botInstance.stopPlatform === 'function') {
    ['telegram', 'discord', 'slack', 'teams', 'email', 'github'].forEach((name) => {
      botInstance.stopPlatform(name);
    });
  }
}

// IPC Handlers
ipcMain.handle('get-status', () => {
  return getPlatformStatus();
});

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
  shell.openExternal(`http://localhost:${store.get('port')}`);
  return { ok: true };
});

ipcMain.handle('get-port', () => {
  return store.get('port');
});

ipcMain.handle('set-port', (_event, port) => {
  const portNum = parseInt(port, 10);
  if (portNum < 1024 || portNum > 65535) {
    return { error: 'Port must be between 1024 and 65535' };
  }
  store.set('port', portNum);
  return { ok: true, port: portNum, needsRestart: true };
});

// App lifecycle
app.on('ready', async () => {
  // Set DATA_DIR to app's user data path
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.PORT = store.get('port');

  // Set up Electron UI first
  createWindow();
  createTray();

  // Require and start the bot (after paths are set)
  // Use setImmediate to avoid potential race conditions
  setImmediate(async () => {
    try {
      // Clear require cache to ensure fresh load
      delete require.cache[require.resolve('../bot')];
      const botModule = require('../bot');
      botInstance = botModule;
      await botModule.start();
    } catch (err) {
      console.error('Bot startup failed:', err);
      console.error('Stack:', err.stack);
      if (mainWindow) {
        mainWindow.webContents.send('bot-error', err.message);
      }
    }
  });

  // Suppress quit on window close — only tray exit
  app.on('window-all-closed', () => {
    // Don't quit the app when windows are closed
  });
});

app.on('before-quit', () => {
  if (botInstance && typeof botInstance.shutdown === 'function') {
    botInstance.shutdown('app-quit');
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}
