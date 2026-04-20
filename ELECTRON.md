# PromptBridge Desktop App

This document describes the Electron desktop application for PromptBridge, which allows users to run the bot without installing Node.js.

## Features

- **System Tray Integration**: Minimalist tray icon with quick access menu
- **Control Window**: Dedicated UI for starting/stopping individual platforms
- **Per-Platform Controls**: Start/stop Telegram, Discord, Slack, Teams, Email, and GitHub independently
- **Port Configuration**: Change dashboard port from the control window
- **Dashboard Integration**: Auto-opens the web dashboard in your browser
- **Cross-Platform**: Builds for Windows (NSIS installer + portable), macOS, and Linux

## Development

### Running in Dev Mode

```bash
npm run electron:dev
```

This launches the Electron app in development mode with DevTools enabled.

### Testing Individual Platforms

From the control window:
1. Each platform shows as a card with its configuration status
2. Click **Start** to launch a platform (only available if configured in dashboard)
3. Click **Stop** to gracefully shut down a platform
4. **Start All** / **Stop All** buttons toggle all platforms at once

### Port Configuration

1. In the control window header, enter a new port number (1024–65535)
2. Click **Save**
3. A "Restart required" banner appears
4. The app will restart services on the new port

## Building

**Note**: Before building, icons are automatically generated from `public/logo.png` via the `prebuild` script.

### Windows

```bash
npm run build:win
```

Produces:
- `PromptBridge-Setup-X.X.X.exe` (NSIS installer)
- `PromptBridge-X.X.X.exe` (portable executable)

Location: `dist/`

### macOS

```bash
npm run build:mac
```

Produces: `PromptBridge-X.X.X.dmg`

### Linux

```bash
npm run build:linux
```

Produces: `PromptBridge-X.X.X.AppImage`

### All Platforms

```bash
npm run build
```

## Architecture

### File Structure

```
electron/
  main.js                 Electron main process (app lifecycle, tray, IPC)
  preload.js             Context bridge (secure IPC to renderer)
  control.html           Control window UI (platform cards, buttons)
  assets/
    icon.png            256x256 PNG (Linux, macOS fallback)
    icon.ico            Windows icon
    icon.icns           macOS icon
    create-proper-icons.js  Icon generation script
```

### Process Flow

1. **Startup**: `electron/main.js` → sets `DATA_DIR` env var → requires `bot.js` → calls `bot.start()`
2. **Platform Control**: IPC calls from `control.html` → `main.js` handlers → `bot.startPlatform()` / `bot.stopPlatform()`
3. **Status Updates**: `control.html` polls `bot.getPlatformStatus()` every 2 seconds via IPC
4. **Shutdown**: User quits app → `before-quit` event → calls `bot.shutdown()` → process exit

### Data Directory

Platform-specific user data directory (set by Electron before bot starts):
- **Windows**: `%APPDATA%\PromptBridge\data`
- **macOS**: `~/Library/Application Support/PromptBridge/data`
- **Linux**: `~/.config/PromptBridge/data`

### IPC Channels

**From renderer to main (async)**:
- `get-status` → `{ platforms: {telegram: {running, configured}, ...}, version, port, ...}`
- `start-platform(name)` → `{ ok: true }`
- `stop-platform(name)` → `{ ok: true }`
- `open-dashboard()` → `{ ok: true }`
- `get-port()` → `3000` (or configured port)
- `set-port(port)` → `{ ok: true, port: X, needsRestart: true }`

**From main to renderer (fire-and-forget)**:
- `bot-error` → `error message` (sent on bot startup failure)

## Configuration

### Environment Variables (at startup)

- `DATA_DIR` — set by `main.js` to app's userData directory
- `PORT` — set by `main.js` from electron-store (default 3000)
- `NODE_ENV` — set via `npm run electron:dev` (enables DevTools)

### Port Persistence

Port settings are stored in electron-store (platform-specific):
- **Windows**: `%APPDATA%\PromptBridge\config.json` (electron-store)
- **macOS**: `~/Library/Application Support/PromptBridge/config.json`
- **Linux**: `~/.config/PromptBridge/config.json`

## Troubleshooting

### "Bot startup failed"

Check browser console (DevTools in dev mode) or the banner in the control window. Ensure:
1. Configuration is valid in dashboard settings
2. Tokens are correctly set
3. `NODE_PATH` includes the bot's `node_modules`

### Ports in use

If a port is already in use:
1. Change the port in the control window
2. Click Save
3. The app restarts on the new port

### Symlink errors on Windows (build)

If building fails with symlink errors, the cache needs to be cleared. The build system handles this automatically, but you can manually clear:

```bash
rmdir /s /q "%APPDATA%\electron-builder"
npm run build:win
```

## Future Improvements

1. **Custom icons** — Replace placeholder icons with real PromptBridge branding
2. **Auto-update** — electron-updater integration for auto-updating releases
3. **Logs viewer** — Built-in log viewer in the control window
4. **Platform-specific menus** — Full macOS app menu integration
5. **Status notifications** — OS notifications on platform start/stop events
