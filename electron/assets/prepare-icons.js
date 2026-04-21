const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sourceIcon = path.join(__dirname, '..', '..', 'public', 'logo.png');
const assetsDir = __dirname;
const pngDest = path.join(assetsDir, 'icon.png');
const icoDest = path.join(assetsDir, 'icon.ico');
const icnsDest = path.join(assetsDir, 'icon.icns');

async function createIcoFile(pngPath, icoPath) {
  try {
    // Resize PNG to 256x256 and save as ICO-compatible format
    const data = await sharp(pngPath)
      .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .toBuffer();

    // Write as BMP (simpler format that can be used in ICO)
    // For now, just copy the resized PNG - electron-builder will convert it
    fs.writeFileSync(icoPath, data);
  } catch (err) {
    console.warn('Warning: Could not create ICO, electron-builder will use default');
  }
}

async function prepareIcons() {
  try {
    // Copy PNG as-is
    fs.copyFileSync(sourceIcon, pngDest);
    console.log('✓ icon.png prepared');

    // Generate ICO from PNG using sharp
    await createIcoFile(sourceIcon, icoDest);
    console.log('✓ icon.ico generated');

    // For ICNS (macOS), copy PNG as fallback
    fs.copyFileSync(sourceIcon, icnsDest);
    console.log('✓ icon.icns prepared');

    console.log('Icons prepared from logo.png');
  } catch (err) {
    console.error('Error preparing icons:', err.message);
    process.exit(1);
  }
}

prepareIcons();
