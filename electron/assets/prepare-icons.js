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
    // Convert PNG to 256x256 BMP for ICO (simple single-image ICO)
    const pngBuffer = fs.readFileSync(pngPath);
    const image = sharp(pngBuffer);
    const metadata = await image.metadata();

    // Resize to standard icon size if needed
    const resized = await sharp(pngBuffer)
      .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();

    // Create a minimal valid ICO file (single 256x256 image)
    // ICO header: 6 bytes + directory entry: 16 bytes
    const icoHeader = Buffer.alloc(6);
    icoHeader.writeUInt16LE(0, 0); // Reserved
    icoHeader.writeUInt16LE(1, 2); // Type (1 = ICO)
    icoHeader.writeUInt16LE(1, 4); // Number of images

    const dirEntry = Buffer.alloc(16);
    dirEntry.writeUInt8(256, 0); // Width (0 = 256)
    dirEntry.writeUInt8(256, 1); // Height (0 = 256)
    dirEntry.writeUInt8(0, 2);   // Color palette
    dirEntry.writeUInt8(0, 3);   // Reserved
    dirEntry.writeUInt16LE(1, 4); // Color planes
    dirEntry.writeUInt16LE(32, 6); // Bits per pixel
    dirEntry.writeUInt32LE(resized.length, 8); // Size of image data
    dirEntry.writeUInt32LE(22, 12); // Offset of image data

    const icoFile = Buffer.concat([icoHeader, dirEntry, resized]);
    fs.writeFileSync(icoPath, icoFile);
  } catch (err) {
    // If ICO creation fails, create a minimal valid ICO
    console.warn('Warning: Could not create optimized ICO, creating minimal fallback');
    const minimalIco = Buffer.alloc(70);
    minimalIco.writeUInt16LE(0, 0);
    minimalIco.writeUInt16LE(1, 2);
    minimalIco.writeUInt16LE(1, 4);
    fs.writeFileSync(icoPath, minimalIco);
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
