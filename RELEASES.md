# Building & Releasing PromptBridge

## Automated Cross-Platform Builds (GitHub Actions)

### How It Works

GitHub Actions automatically builds for **Windows, macOS, and Linux** whenever you:
1. Push to `main` branch
2. Create a git tag (for releases)

No need to own a Mac or Linux machine!

### Workflow

```
Push code → GitHub Actions starts
  ↓
  ├─ Windows build (windows-latest runner)
  ├─ macOS build (macos-latest runner)
  └─ Linux build (ubuntu-latest runner)
       ↓
    All succeed → Artifacts available for download
       ↓
    Tag pushed (v2.0.0) → Automatic GitHub Release created
```

## Creating a Release

### Step 1: Make your changes

```bash
git add .
git commit -m "feat: add new feature"
git push origin main
```

### Step 2: Create a tag (triggers release build)

```bash
git tag v2.1.0
git push origin v2.1.0
```

### Step 3: Wait for builds to complete

- Go to: https://github.com/abhins0554/PromptBridge/actions
- Wait for all 3 builds to finish (≈5-10 minutes)
- Check for any failures

### Step 4: Download artifacts

After builds complete:
- **Windows**: `PromptBridge-windows/` folder
- **macOS**: `PromptBridge-2.x.x.dmg`
- **Linux**: `PromptBridge-2.x.x.AppImage`

Click "Artifacts" on the completed workflow run.

## Manual Builds (If Needed)

### On Windows
```bash
npm run build:win
# Output: dist/win-unpacked/PromptBridge.exe
```

### On macOS
```bash
npm run build:mac
# Output: dist/PromptBridge-2.0.0.dmg
```

### On Linux (or WSL2)
```bash
npm run build:linux
# Output: dist/PromptBridge-2.0.0.AppImage
```

## Building on Linux from Windows (WSL2)

If you don't want to wait for GitHub Actions:

```bash
# In PowerShell on Windows
wsl --install Ubuntu

# In Ubuntu WSL terminal
cd /mnt/c/Users/Abhishek/Desktop/telegram-bot
npm install
npm run build:linux
```

## Troubleshooting Builds

### Build fails in GitHub Actions

Check the workflow logs:
1. Go to: https://github.com/abhins0554/PromptBridge/actions
2. Click the failed workflow
3. Expand "Build" step to see error details
4. Common issues:
   - Missing dependencies → run `npm install`
   - Node version mismatch → update `.github/workflows/build.yml` Node version
   - Token/environment variable not set → check `.env` file

### Artifact not created

- Windows: Check that `dist/win-unpacked/PromptBridge.exe` exists locally
- macOS: Check that `dist/*.dmg` exists locally
- Linux: Check that `dist/*.AppImage` exists locally

If it fails locally, fix it before pushing to GitHub.

## Release Checklist

Before creating a release tag:

- [ ] All commits pushed to main
- [ ] Local build succeeds: `npm run build:win` (or target platform)
- [ ] Tests pass (if any)
- [ ] Version bumped in `package.json`
- [ ] CHANGELOG updated
- [ ] Commit and push changes
- [ ] Create tag: `git tag v2.x.x`
- [ ] Push tag: `git push origin v2.x.x`

After release:
- [ ] Check GitHub Actions workflow completes
- [ ] Download and test each artifact
- [ ] Update README with new version
- [ ] Announce release on your channels

## File Structure

```
.github/workflows/
  build.yml          ← Automated build configuration
RELEASES.md          ← This file
```

## Questions?

See:
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [electron-builder Docs](https://www.electron.build)
- [Build instructions](BUILD_WINDOWS.md)
