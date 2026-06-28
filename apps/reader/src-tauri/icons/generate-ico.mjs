// Generate icon.ico from PNG files (16, 32, 48, 64, 128, 256 px).
// ICO format: multiple PNG images embedded directly (PNG-in-ICO, supported since Vista).
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use the available sizes — ICO supports PNG embedding directly
const entries = [
  { size: 32, file: '32x32.png' },
  { size: 64, file: '64x64.png' },
  { size: 128, file: '128x128.png' },
  { size: 256, file: '128x128@2x.png' }, // 256x256
];

const pngBuffers = entries.map(e => {
  const buf = readFileSync(join(__dirname, e.file));
  return { size: e.size, data: buf };
});

// ICO file format:
// Header: 6 bytes (reserved=0, type=1 for ICO, count)
// Directory entries: 16 bytes each
// Image data: raw PNG bytes

const count = pngBuffers.length;
const headerSize = 6;
const dirEntrySize = 16;
const dirSize = dirEntrySize * count;
let dataOffset = headerSize + dirSize;

// Header
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = ICO
header.writeUInt16LE(count, 4);

// Directory entries
const dirEntries = [];
const imageDataParts = [];

for (const { size, data } of pngBuffers) {
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 = 256)
  entry[1] = size >= 256 ? 0 : size; // height (0 = 256)
  entry[2] = 0; // color palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(data.length, 8); // image data size
  entry.writeUInt32LE(dataOffset, 12); // offset to image data
  dirEntries.push(entry);
  imageDataParts.push(data);
  dataOffset += data.length;
}

const ico = Buffer.concat([header, ...dirEntries, ...imageDataParts]);
writeFileSync(join(__dirname, 'icon.ico'), ico);
console.log(`✓ icon.ico generated (${count} sizes: ${pngBuffers.map(p => p.size).join(', ')})`);
