const fs = require('fs');
const path = require('path');

// Create a simple gradient PNG 256x256
function createPNG256() {
  const size = 256;
  const pixelData = [];
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.floor(99 + (50 * x / size));
      const g = Math.floor(102 + (51 * y / size));
      const b = Math.floor(241 - (100 * x / size));
      pixelData.push(r, g, b);
    }
  }
  
  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]);
  
  const ihdr = Buffer.alloc(25);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(size, 8);
  ihdr.writeUInt32BE(size, 12);
  ihdr.writeUInt8(8, 16);
  ihdr.writeUInt8(2, 17);
  
  const output = Buffer.concat([header, ihdr]);
  fs.writeFileSync(path.join(__dirname, 'icon.png'), output);
  console.log('Created icon.png');
}

// Create ICO (Windows icon)
function createICO256() {
  const buffer = Buffer.alloc(50 + 65536);
  buffer.write('\x00\x00\x01\x00', 0);
  buffer.writeUInt16LE(1, 4);
  buffer.writeUInt8(0, 6);
  buffer.writeUInt8(0, 7);
  buffer.writeUInt8(0, 8);
  buffer.writeUInt8(0, 9);
  buffer.writeUInt16LE(32, 10);
  buffer.writeUInt16LE(32, 12);
  buffer.writeUInt32LE(buffer.length - 22, 14);
  buffer.writeUInt32LE(22, 18);
  
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), buffer);
  console.log('Created icon.ico');
}

// Create ICNS (macOS icon)
function createICNS256() {
  const buffer = Buffer.alloc(1024);
  buffer.write('icns', 0);
  buffer.writeUInt32BE(buffer.length, 4);
  fs.writeFileSync(path.join(__dirname, 'icon.icns'), buffer);
  console.log('Created icon.icns');
}

createPNG256();
createICO256();
createICNS256();
