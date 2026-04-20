console.log('Starting main process...');
const electronPackage = require('electron');
console.log('Electron package loaded:', Object.keys(electronPackage).slice(0, 10));

const { app, BrowserWindow, Menu, ipcMain, shell } = electronPackage;
console.log('Destructured - app:', typeof app);

const Store = require('electron-store');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

console.log('Electron app starting...');

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
}

function createTray() {
  const { Tray } = require('electron');
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  try {
    trayIcon = new Tray(iconPath);
    console.log('Tray icon created');

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
    setInterval(updateTrayMenu, 2000);

    trayIcon.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      } else {
        createWindow();
      }
    });
  } catch (err) {
    console.error('Failed to create tray:', err);
  }
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

// Register IPC Handlers
function setupIpcHandlers() {
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
}

// App lifecycle
app.on('ready', () => {
  console.log('App ready event fired');

  try {
    // Set DATA_DIR to app's user data path
    process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
    process.env.PORT = store.get('port');
    console.log('Environment set. Creating window and tray...');

    createWindow();
    createTray();
    setupIpcHandlers();

    // Start the bot
    setImmediate(() => {
      try {
        console.log('Loading bot module...');
        delete require.cache[require.resolve('../bot')];
        const botModule = require('../bot');
        botInstance = botModule;
        console.log('Starting bot...');
        botModule.start().then(() => {
          console.log('Bot started successfully');
        }).catch((err) => {
          console.error('Bot startup error:', err.message);
        });
      } catch (err) {
        console.error('Failed to load/start bot:', err.message);
      }
    });

    app.on('window-all-closed', () => {
      // Don't quit - keep tray alive
    });
  } catch (err) {
    console.error('Ready event error:', err);
    process.exit(1);
  }
});

app.on('before-quit', () => {
  console.log('App quitting, shutting down bot...');
  if (botInstance && typeof botInstance.shutdown === 'function') {
    try {
      botInstance.shutdown('app-quit');
    } catch (e) {
      console.error('Bot shutdown error:', e);
    }
  }
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance is running, quitting...');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
