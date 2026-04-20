# Building PromptBridge

## Windows Build

### Prerequisites

Move `electron-store` to runtime dependencies (already done in package.json).

### Option 1: Run as Administrator (Recommended)

The Windows build requires admin privileges to handle symbolic links during code signing tool extraction:

```bash
# Open Command Prompt or PowerShell as Administrator, then:
npm run build:win
```

This will create:
- `dist\PromptBridge-2.0.0.exe` (portable executable)

### Option 2: Enable Developer Mode (One-time setup)

Alternatively, enable Windows Developer Mode to allow symlink creation without admin:

1. Open **Settings** → **System** → **For developers**
2. Enable **Developer Mode**
3. Restart your computer
4. Run: `npm run build:win`

### Why This is Needed

- **electron-builder** downloads `winCodeSign-2.6.0.7z` (~5.6 MB)
- This archive contains macOS binaries with symbolic links
- Windows must extract these symlinks, which requires elevated privileges
- CSC_IDENTITY_AUTO_DISCOVERY=false doesn't skip tool download, only certificate discovery

### Troubleshooting

**Error: "Cannot create symbolic link: A required privilege is not held by the client"**

1. Open Command Prompt or PowerShell **as Administrator**
2. Run: `npm run build:win`
3. Wait for build to complete (~2-3 minutes)

**Build succeeds but installer won't run:**
- Ensure you're on Windows 7 or newer
- Check that the app has permission to write to the installation directory

## macOS & Linux Builds

### Build for macOS
Requires macOS:
```bash
npm run build:mac
```
Output: `dist/PromptBridge-2.0.0.dmg`

### Build for Linux
Requires Linux or WSL2:
```bash
npm run build:linux
```
Output: `dist/PromptBridge-2.0.0.AppImage`

**Note**: Cannot cross-compile Linux binaries from Windows. Use WSL2 or a Linux machine.

### Using WSL2 for Linux builds:
```bash
# In PowerShell on Windows:
wsl --install Ubuntu

# In Ubuntu WSL terminal:
cd /mnt/c/Users/Abhishek/Desktop/telegram-bot
npm install
npm run build:linux
```

## Automated Builds with GitHub Actions

For cross-platform builds without local setup, use GitHub Actions:
1. Push code to GitHub: `git push origin main`
2. CI automatically builds for Windows, macOS, and Linux
3. Download releases from GitHub Releases page

See `.github/workflows/build.yml` (if configured).
