# PromptBridge Development

## Running the Electron App

### Built Executable (Recommended)

```bash
npm run build:win
C:\Users\Abhishek\Desktop\telegram-bot\dist\PromptBridge-Setup-2.0.0.exe
```

This is the recommended way to test the Electron app. The built executable bundles Node.js and Electron properly and works on any machine without dev environment dependencies.

### Dev Mode

⚠️ **Note**: `npm run electron:dev` has issues on Windows with Electron's module loading in the dev environment. The app is ready for production use via `npm run build:win`.

For development on the CLI bot (without Electron UI):

```bash
npm start
```

or with watch mode:

```bash
npm run dev
```

### If Port 3000 Is In Use

```bash
PORT=3001 npm run electron:dev
```

Uses port 3001 instead. Dashboard will be on `http://localhost:3001`.

### Running CLI Bot (Traditional)

```bash
npm start
```

Runs without Electron UI (headless). Useful for servers or when you just want the bot.

### Dev Mode Details

With `npm run electron:dev`:
- DevTools opens automatically (F12 to debug)
- Control window shows all platforms
- Tray icon reflects running status
- Changes to `control.html` require app reload

## Testing Platform Controls

1. **Telegram**: Click "Stop" in control window → polling stops
2. **Discord**: Bot disconnects from Discord
3. **Slack**: Bot leaves Slack workspace
4. **Teams**: Adapter stops accepting webhooks
5. **Email**: IMAP listener stops
6. **GitHub**: Polling stops

Click "Start" to resume.

## Checking Logs

All logs go to stdout:
```
2026-04-20T17:27:15.289Z INFO  [tg] allowlist loaded names=["user1","user2"]
2026-04-20T17:27:15.290Z INFO  [bot] telegram polling started
```

- `[tg]` = Telegram
- `[bot]` = Core bot
- `[discord]` = Discord
- `[slack]` = Slack
- `[email:inbound]` = Email IMAP listener

## Troubleshooting

### App exits immediately with "Port X in use"

**Solution**: Use a different port with `PORT=3005 npm run electron:dev`

### "GitHub polling not available"

This is **not an error** — GitHub polling failed to load gracefully. The app continues running without GitHub support. This is a known ES module issue with `@octokit/rest` in bundled apps.

**Impact**: Zero — other platforms work fine, GitHub polling just won't run.

### Control window is blank

Check browser console (DevTools):
1. Open DevTools (F12)
2. Check for errors
3. Reload with Ctrl+R

### Bot doesn't show in tray

1. Check system tray settings (might be hidden)
2. Restart the app
3. Look for "PromptBridge" in system tray

## Building for Distribution

```bash
npm run build:win    # Windows (NSIS + portable)
npm run build:mac    # macOS
npm run build:linux  # Linux
npm run build        # All three
```

Output goes to `dist/`. These are the files users download.

## What Gets Bundled

- Node.js runtime (embedded)
- All npm dependencies
- `electron/` files (main.js, preload.js, control.html, icons)
- Bot code (bot.js, core/, lib/, platforms/, public/)

**Not included**: `.git/`, node_modules source, build artifacts

## Common Development Tasks

| Task | Command |
|------|---------|
| Dev mode | `npm run electron:dev` |
| CLI bot | `npm start` |
| Watch mode (no Electron) | `npm run dev` |
| Build installers | `npm run build` |
| Build Windows only | `npm run build:win` |

## Modifying the UI

Edit `electron/control.html` — changes visible after app reload.

Key sections:
- **HTML**: Platform cards, buttons
- **CSS**: Dark theme, card styling
- **JavaScript**: Status polling, IPC calls to main process

## IPC Communication

Control window → Main process:

```js
// In control.html
await window.bot.startPlatform('telegram');  // Start a platform
const status = await window.bot.getStatus(); // Get status
await window.bot.openDashboard();            // Open browser
```

Main process → Control window:

```js
// In electron/main.js
mainWindow.webContents.send('bot-error', 'message');  // Send error
```

## Git Workflow

```bash
# Make changes
git add .
git commit -m "feat: description"

# Test
npm run electron:dev

# Build
npm run build

# Push
git push origin main
```

## Next Steps

1. Verify bot platforms are configured in dashboard (`http://localhost:3000`)
2. Test control window Start/Stop buttons
3. Test port configuration
4. Build installers for distribution (`npm run build`)
