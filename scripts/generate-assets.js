/**
 * Generate Placeholder Assets for PTP Soccer App
 *
 * Run with: node scripts/generate-assets.js
 *
 * This creates minimal placeholder images that should be replaced
 * with actual brand assets before production.
 */

const fs = require('fs');
const path = require('path');

// Minimal 1x1 PNG (transparent) as base64
const TRANSPARENT_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Simple colored PNG generator (creates a solid color square)
function createColoredPNG(width, height, r, g, b) {
  // PNG file structure
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT chunk (image data)
  const zlib = require('zlib');
  const rawData = Buffer.alloc(height * (1 + width * 3));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    rawData[rowStart] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const pixelStart = rowStart + 1 + x * 3;
      rawData[pixelStart] = r;
      rawData[pixelStart + 1] = g;
      rawData[pixelStart + 2] = b;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data]));

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 implementation for PNG
function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  const table = makeCRCTable();

  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xFF];
  }

  return crc ^ 0xFFFFFFFF;
}

function makeCRCTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[n] = c;
  }
  return table;
}

// PTP Brand Colors
const PTP_YELLOW = { r: 252, g: 185, b: 0 };    // #FCB900
const PTP_INK = { r: 14, g: 15, b: 17 };        // #0E0F11

// Create assets directory if it doesn't exist
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Generate app icon (1024x1024 for App Store, will be resized)
console.log('Generating icon.png (1024x1024)...');
const iconPng = createColoredPNG(1024, 1024, PTP_INK.r, PTP_INK.g, PTP_INK.b);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), iconPng);

// Generate adaptive icon foreground for Android (1024x1024)
console.log('Generating adaptive-icon.png (1024x1024)...');
const adaptiveIconPng = createColoredPNG(1024, 1024, PTP_YELLOW.r, PTP_YELLOW.g, PTP_YELLOW.b);
fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), adaptiveIconPng);

// Generate splash screen (1284x2778 for iPhone 14 Pro Max)
console.log('Generating splash.png (1284x2778)...');
const splashPng = createColoredPNG(1284, 2778, PTP_INK.r, PTP_INK.g, PTP_INK.b);
fs.writeFileSync(path.join(assetsDir, 'splash.png'), splashPng);

// Generate favicon (48x48)
console.log('Generating favicon.png (48x48)...');
const faviconPng = createColoredPNG(48, 48, PTP_INK.r, PTP_INK.g, PTP_INK.b);
fs.writeFileSync(path.join(assetsDir, 'favicon.png'), faviconPng);

// Generate notification icon (96x96, Android)
console.log('Generating notification-icon.png (96x96)...');
const notificationIconPng = createColoredPNG(96, 96, PTP_YELLOW.r, PTP_YELLOW.g, PTP_YELLOW.b);
fs.writeFileSync(path.join(assetsDir, 'notification-icon.png'), notificationIconPng);

console.log('\nPlaceholder assets generated successfully!');
console.log('Replace these with actual brand assets before production.');
console.log('\nGenerated files:');
console.log('  - assets/icon.png (1024x1024) - App icon');
console.log('  - assets/adaptive-icon.png (1024x1024) - Android adaptive icon');
console.log('  - assets/splash.png (1284x2778) - Splash screen');
console.log('  - assets/favicon.png (48x48) - Web favicon');
console.log('  - assets/notification-icon.png (96x96) - Notification icon');
