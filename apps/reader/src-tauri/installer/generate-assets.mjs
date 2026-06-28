// Generate NSIS and WiX installer banner/sidebar images as BMP.
// Pure Node.js — no native deps.
// Run: node installer/generate-assets.mjs
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Brand gradient
const TOP = [74, 144, 226];    // #4A90E2
const BOT = [43, 94, 167];    // #2B5EA7

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function createGradientBuffer(w, h) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1 || 1);
    const r = lerp(TOP[0], BOT[0], t);
    const g = lerp(TOP[1], BOT[1], t);
    const b = lerp(TOP[2], BOT[2], t);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      buf[i] = r; buf[i+1] = g; buf[i+2] = b;
    }
  }
  return buf;
}

// 5x7 pixel font
const FONT = {
  'J': ['01110','00010','00010','00010','10010','10010','01100'],
  'D': ['11100','10010','10001','10001','10001','10010','11100'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'e': ['00000','00000','01110','10001','11111','10000','01110'],
  'a': ['00000','00000','01110','00001','01111','10001','01111'],
  'd': ['00001','00001','01101','10011','10001','10001','01111'],
  'r': ['00000','00000','10110','11001','10000','10000','10000'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
};

function drawChar(buf, w, ch, ox, oy, scale, color) {
  const glyph = FONT[ch];
  if (!glyph) return;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (glyph[row][col] === '1') {
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = ox + col * scale + sx;
            const py = oy + row * scale + sy;
            if (px >= 0 && px < w && py >= 0) {
              const i = (py * w + px) * 3;
              buf[i] = color[0]; buf[i+1] = color[1]; buf[i+2] = color[2];
            }
          }
        }
      }
    }
  }
}

function drawStringAt(buf, w, h, str, scale, color, oy) {
  const charW = 6 * scale;
  const totalW = str.length * charW - scale;
  const ox = Math.floor((w - totalW) / 2);
  for (let i = 0; i < str.length; i++) {
    drawChar(buf, w, str[i], ox + i * charW, oy, scale, color);
  }
}

function drawStringCenter(buf, w, h, str, scale, color) {
  const textH = 7 * scale;
  drawStringAt(buf, w, h, str, scale, color, Math.floor((h - textH) / 2));
}

// Encode as 24-bit BMP (bottom-up, no compression)
function encodeBMP(rgbBuf, w, h) {
  const rowSize = Math.ceil((w * 3) / 4) * 4; // rows padded to 4-byte boundary
  const pixelDataSize = rowSize * h;
  const fileSize = 54 + pixelDataSize;
  const bmp = Buffer.alloc(fileSize);

  // BMP File Header (14 bytes)
  bmp.write('BM', 0);
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(0, 6); // reserved
  bmp.writeUInt32LE(54, 10); // pixel data offset

  // DIB Header - BITMAPINFOHEADER (40 bytes)
  bmp.writeUInt32LE(40, 14); // header size
  bmp.writeInt32LE(w, 18);
  bmp.writeInt32LE(h, 22); // positive = bottom-up
  bmp.writeUInt16LE(1, 26); // planes
  bmp.writeUInt16LE(24, 28); // bits per pixel
  bmp.writeUInt32LE(0, 30); // compression (none)
  bmp.writeUInt32LE(pixelDataSize, 34);
  bmp.writeInt32LE(2835, 38); // h resolution (72 DPI)
  bmp.writeInt32LE(2835, 42); // v resolution
  bmp.writeUInt32LE(0, 46); // colors in palette
  bmp.writeUInt32LE(0, 50); // important colors

  // Pixel data (bottom-up, BGR)
  for (let y = 0; y < h; y++) {
    const srcRow = h - 1 - y; // BMP is bottom-up
    for (let x = 0; x < w; x++) {
      const srcIdx = (srcRow * w + x) * 3;
      const dstIdx = 54 + y * rowSize + x * 3;
      bmp[dstIdx] = rgbBuf[srcIdx + 2];     // B
      bmp[dstIdx + 1] = rgbBuf[srcIdx + 1]; // G
      bmp[dstIdx + 2] = rgbBuf[srcIdx];     // R
    }
  }

  return bmp;
}

const WHITE = [255, 255, 255];

// NSIS Sidebar: 164x314
function nsisSidebar() {
  const w = 164, h = 314;
  const buf = createGradientBuffer(w, h);
  drawStringAt(buf, w, h, 'JDF', 6, WHITE, Math.floor(h/2) - 35);
  drawStringAt(buf, w, h, 'Reader', 3, WHITE, Math.floor(h/2) + 20);
  return encodeBMP(buf, w, h);
}

// NSIS Header: 150x57
function nsisHeader() {
  const w = 150, h = 57;
  const buf = createGradientBuffer(w, h);
  drawStringCenter(buf, w, h, 'JDF', 3, WHITE);
  return encodeBMP(buf, w, h);
}

// WiX Banner: 493x58
function wixBanner() {
  const w = 493, h = 58;
  const buf = createGradientBuffer(w, h);
  drawStringCenter(buf, w, h, 'JDF Reader', 3, WHITE);
  return encodeBMP(buf, w, h);
}

// WiX Dialog: 493x312
function wixDialog() {
  const w = 493, h = 312;
  const buf = createGradientBuffer(w, h);
  drawStringAt(buf, w, h, 'JDF', 8, WHITE, Math.floor(h/2) - 50);
  drawStringAt(buf, w, h, 'Reader', 4, WHITE, Math.floor(h/2) + 30);
  return encodeBMP(buf, w, h);
}

writeFileSync(join(__dirname, 'nsis-sidebar.bmp'), nsisSidebar());
writeFileSync(join(__dirname, 'nsis-header.bmp'), nsisHeader());
writeFileSync(join(__dirname, 'wix-banner.bmp'), wixBanner());
writeFileSync(join(__dirname, 'wix-dialog.bmp'), wixDialog());

console.log('✓ Generated BMP installer assets in', __dirname);
