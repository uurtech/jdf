// Use sharp to cleanly remove white background from icon PNGs.
// Strategy: create a rounded-rect alpha mask matching the icon shape,
// composite it onto the original to get perfect smooth transparent edges.
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function fixIcon(filePath) {
  const img = sharp(filePath);
  const meta = await img.metadata();
  const { width, height } = meta;

  // The icon is a rounded rect. We create an SVG mask that matches it.
  // From the original icon (512px): padding ~10px each side, radius ~90px
  // Ratios: padding = 0.02, radius = 0.175
  const padding = Math.round(width * 0.02);
  const radius = Math.round(width * 0.175);
  const rectW = width - padding * 2;
  const rectH = height - padding * 2;

  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${padding}" y="${padding}" width="${rectW}" height="${rectH}" rx="${radius}" ry="${radius}" fill="white"/>
  </svg>`;

  // Extract alpha from mask: white = opaque, black = transparent
  const mask = await sharp(Buffer.from(maskSvg))
    .grayscale()
    .toBuffer();

  // Apply the mask as alpha channel to original image
  // First, flatten the original (remove any existing alpha, composite on white)
  // Then join with the mask as the alpha channel
  const flatImage = await sharp(filePath)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer();

  const maskRaw = await sharp(Buffer.from(maskSvg))
    .resize(width, height)
    .grayscale()
    .raw()
    .toBuffer();

  // Combine: RGB from original + A from mask
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4]     = flatImage[i * 3];
    rgba[i * 4 + 1] = flatImage[i * 3 + 1];
    rgba[i * 4 + 2] = flatImage[i * 3 + 2];
    rgba[i * 4 + 3] = maskRaw[i]; // grayscale value as alpha
  }

  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(filePath);

  return { width, height };
}

const files = [
  'icon.png', '32x32.png', '64x64.png', '128x128.png', '128x128@2x.png',
  'Square30x30Logo.png', 'Square44x44Logo.png', 'Square71x71Logo.png',
  'Square89x89Logo.png', 'Square107x107Logo.png', 'Square142x142Logo.png',
  'Square150x150Logo.png', 'Square284x284Logo.png', 'Square310x310Logo.png',
  'StoreLogo.png'
];

for (const file of files) {
  const path = join(__dirname, file);
  try {
    const { width, height } = await fixIcon(path);
    console.log(`✓ ${file} (${width}x${height})`);
  } catch (e) {
    console.log(`✗ ${file}: ${e.message}`);
  }
}

// Regenerate ICO
const icoSizes = [
  { size: 16 },
  { size: 32, file: '32x32.png' },
  { size: 48 },
  { size: 64, file: '64x64.png' },
  { size: 128, file: '128x128.png' },
  { size: 256, file: '128x128@2x.png' },
];

const pngBuffers = [];
for (const entry of icoSizes) {
  let buf;
  if (entry.file) {
    buf = readFileSync(join(__dirname, entry.file));
  } else {
    // Generate by resizing 512px icon
    buf = await sharp(join(__dirname, 'icon.png'))
      .resize(entry.size, entry.size, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
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
