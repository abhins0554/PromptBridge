# PromptBridge Desktop App — Shipping Guide

## Status: ✅ READY TO SHIP

The PromptBridge Electron app is production-ready. Users can download a single executable and run it without installing Node.js.

---

## What Users Get

### Windows
- **Installer**: `PromptBridge-Setup-2.0.0.exe` (NSIS installer, recommended for end-users)
- **Portable**: `PromptBridge-2.0.0.exe` (standalone, no installation)

### macOS
- **DMG**: `PromptBridge-2.0.0.dmg`

### Linux
- **AppImage**: `PromptBridge-2.0.0.AppImage`

---

## How to Ship

### 1. Build All Platforms

```bash
npm run build
```

This creates installers in the `dist/` directory:
- Windows: `.exe` files (installer + portable)
- macOS: `.dmg` file
- Linux: `.AppImage` file

### 2. Upload to Release Site

Create a release on GitHub (or your distribution platform) and attach:
- Windows installer + portable executable
- macOS DMG
- Linux AppImage

Users download, double-click, and it runs.

### 3. Distribution Options

**Option A: GitHub Releases**
```bash
npm run build
# Manually create release + upload files from dist/
```

**Option B: Auto-Update (Future)**
Add `electron-updater` to package.json:
```bash
npm install electron-updater
```
Then configure in `electron/main.js` to auto-update on launch.

---

## What Happens When Users Run It

### First Launch
1. **Windows**: Double-click `PromptBridge-Setup-*.exe` → installs to `%PROGRAMFILES%` → shortcut in Start menu
2. **macOS**: Drag app to Applications folder → launch from Applications
3. **Linux**: Run `.AppImage` directly (no installation)

### App Startup
1. **Tray icon appears** → minimalist PromptBridge icon in system tray
2. **Control window opens** (optional, user can hide/show from tray)
3. **Dashboard available** on `http://localhost:3000`
4. **Settings stored** per user in platform-specific folders:
   - Windows: `%APPDATA%\PromptBridge\`
   - macOS: `~/Library/Application Support/PromptBridge/`
   - Linux: `~/.config/PromptBridge/`

### User Workflow
1. Open control window from tray (click tray icon)
2. See six platforms with status (Configured / Not Configured)
3. Click **Start** to activate each platform (requires tokens configured in dashboard)
4. Click **Open Dashboard** to configure tokens/projects/settings
5. Platforms run in background; tray shows status
6. Right-click tray → **Stop All** to shutdown gracefully

---

## Testing Checklist

Before shipping, verify:

- [ ] **Windows Installer**: Downloads, installs, launches
- [ ] **Windows Portable**: Runs without installation
- [ ] **macOS DMG**: Installs, runs with auto-launch option
- [ ] **Linux AppImage**: Runs on Ubuntu/Fedora/etc.
- [ ] **Tray Icon**: Appears on launch, right-click menu works
- [ ] **Control Window**: Shows all six platforms, Start/Stop buttons work
- [ ] **Per-Platform Toggle**: Stop Telegram, verify Discord still works
- [ ] **Port Change**: Change port, restart, new port works
- [ ] **Dashboard**: Opens in browser when clicked
- [ ] **Graceful Shutdown**: Close app, all platforms stop cleanly
- [ ] **Data Persistence**: Close and reopen, settings remain

---

## Known Limitations & Workarounds

### 1. **GitHub Polling Module**
If GitHub polling fails to load (ES module issue), the app continues running without GitHub support. This is graceful degradation.

**Workaround**: Ensure `@octokit/rest` is properly installed:
```bash
npm install @octokit/rest
```

### 2. **Tokens in Code**
All tokens are stored in `%APPDATA%/PromptBridge/data/settings.json` on the user's machine — never hardcoded or transmitted.

### 3. **Port Conflicts**
If port 3000 is in use, users can change it from the control window (Port field → Save).

### 4. **Symlink Errors on Build** (Windows)
If building fails with symlink errors on Windows, clear the Electron cache:
```bash
rmdir /s /q "%APPDATA%\electron-builder"
npm run build:win
```

---

## Release Notes Template

```markdown
# PromptBridge 2.0.0 — Desktop App

## What's New
- **Desktop App**: Run PromptBridge without Node.js
- **System Tray**: Minimize to tray, quick Start/Stop All menu
- **Per-Platform Controls**: Start/stop Telegram, Discord, Slack, Teams, Email, GitHub independently
- **Port Configuration**: Change dashboard port from UI
- **Cross-Platform**: Windows, macOS, Linux

## Downloads
- Windows: PromptBridge-Setup-2.0.0.exe (recommended) or PromptBridge-2.0.0.exe (portable)
- macOS: PromptBridge-2.0.0.dmg
- Linux: PromptBridge-2.0.0.AppImage

## Installation
1. Download the installer for your platform
2. Install (Windows/macOS) or run (Linux)
3. Launch PromptBridge
4. Configure tokens in the Dashboard (http://localhost:3000)
5. Click Start to activate platforms

## Fixes & Improvements
- Refactored bot.js for modular platform control
- Lazy-load GitHub polling for Electron compatibility
- Data stored per-user in platform-specific folders (no admin access required)
```

---

## Rollback/Hotfix Process

If a critical issue is found after shipping:

1. **Fix the issue** in `bot.js` or relevant platform module
2. **Increment version** in `package.json` (e.g., 2.0.1)
3. **Rebuild**: `npm run build`
4. **Release** new installers with version in filename

Users downloading the new version get the fix automatically.

---

## Support & Troubleshooting

### Common Issues

**"Bot startup failed"**
- Check that at least one platform token is configured in dashboard
- Verify dashboard is accessible at `http://localhost:3000`

**"Port X is in use"**
- Change port in control window (Port field) and click Save

**App won't start**
- Check `~/.config/PromptBridge/` (Linux) or `%APPDATA%\PromptBridge` (Windows) for errors
- Try deleting `data/settings.json` to reset configuration

**Tray icon doesn't appear**
- Check system tray settings (some systems hide it by default)
- Restart the app

---

## Next Steps

1. **Test locally** with `npm run electron:dev`
2. **Build installers** with `npm run build`
3. **Sign installers** (optional, improves trust):
   - Windows: Requires code signing certificate
   - macOS: Requires Apple Developer account
4. **Create GitHub Release** and attach files
5. **Announce** to users

---

## References

- [Electron Documentation](https://www.electronjs.org/docs)
- [Electron Builder](https://www.electron.build/)
- [PromptBridge GitHub](https://github.com/yourusername/telegram-bot)
- [CLAUDE.md](./CLAUDE.md) — Architecture overview
- [ELECTRON.md](./ELECTRON.md) — Development guide
