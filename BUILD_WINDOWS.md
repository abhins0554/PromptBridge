# Building PromptBridge on Windows

## Electron Desktop App Build

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

### Alternative: GitHub Actions

For automated cross-platform builds without local setup issues, use GitHub Actions:
```bash
git push origin main  # Creates Windows/macOS/Linux builds automatically
```

See `.github/workflows/build.yml` (if configured).
