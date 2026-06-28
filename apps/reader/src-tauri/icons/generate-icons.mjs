// Generate all icon sizes from SVG — perfectly smooth anti-aliased edges on transparent bg.
import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createSVG(size) {
  // Rounded rect filling most of the canvas, bold "JDF" text centered
  const padding = size * 0.02;
  const radius = size * 0.20;
  const rectSize = size - padding * 2;
  const fontSize = size * 0.40;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#4A8DF6"/>
      <stop offset="100%" style="stop-color:#1F4FD8"/>
    </linearGradient>
  </defs>
  <rect x="${padding}" y="${padding}" width="${rectSize}" height="${rectSize}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>
  <text x="50%" y="54%" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle" letter-spacing="${size * 0.01}">JDF</text>
</svg>`;
}

const sizes = [
  { file: 'icon.png', size: 512 },
  { file: '32x32.png', size: 32 },
  { file: '64x64.png', size: 64 },
  { file: '128x128.png', size: 128 },
  { file: '128x128@2x.png', size: 256 },
  { file: 'Square30x30Logo.png', size: 30 },
  { file: 'Square44x44Logo.png', size: 44 },
  { file: 'Square71x71Logo.png', size: 71 },
  { file: 'Square89x89Logo.png', size: 89 },
  { file: 'Square107x107Logo.png', size: 107 },
  { file: 'Square142x142Logo.png', size: 142 },
  { file: 'Square150x150Logo.png', size: 150 },
  { file: 'Square284x284Logo.png', size: 284 },
  { file: 'Square310x310Logo.png', size: 310 },
  { file: 'StoreLogo.png', size: 50 },
];

for (const { file, size } of sizes) {
  // Render at 4x then downscale for crisp text at small sizes
  const renderSize = Math.max(size * 4, 512);
  const svg = createSVG(renderSize);
  const outPath = join(__dirname, file);
  await sharp(Buffer.from(svg))
    .resize(size, size, { kernel: 'lanczos3' })
    .sharpen({ sigma: size <= 64 ? 1.2 : 0.8 })
    .png()
    .toFile(outPath);
  console.log(`✓ ${file} (${size}x${size})`);
}

// Generate ICO
const icoSizes = [
  { size: 16, file: null },
  { size: 32, file: '32x32.png' },
  { size: 48, file: null },
  { size: 64, file: '64x64.png' },
  { size: 128, file: '128x128.png' },
  { size: 256, file: '128x128@2x.png' },
];

const pngBuffers = [];
for (const entry of icoSizes) {
  let buf;
  if (entry.file) {
    buf = await sharp(join(__dirname, entry.file)).png().toBuffer();
  } else {
    const svg = createSVG(entry.size);
    buf = await sharp(Buffer.from(svg)).png().toBuffer();
  }
  pngBuffers.push({ size: entry.size, data: buf });
}

const count = pngBuffers.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(count, 4);

let dataOffset = 6 + 16 * count;
const dirEntries = [];
const imageDataParts = [];

for (const { size, data } of pngBuffers) {
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(dataOffset, 12);
  dirEntries.push(entry);
  imageDataParts.push(data);
  dataOffset += data.length;
}

const ico = Buffer.concat([header, ...dirEntries, ...imageDataParts]);
writeFileSync(join(__dirname, 'icon.ico'), ico);
console.log(`\n✓ icon.ico (${count} sizes: ${pngBuffers.map(p => p.size).join(', ')})`);
