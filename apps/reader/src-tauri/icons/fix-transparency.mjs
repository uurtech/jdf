// Remove white background from icon PNGs with proper anti-alias handling.
// Strategy: flood-fill from borders, then for fringe pixels compute alpha
// by referencing the nearest interior (icon) pixel color for accurate un-blending.
import { readFileSync, writeFileSync } from 'fs';
import { deflateSync, inflateSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parsePNG(buf) {
  if (buf[0] !== 137 || buf[1] !== 80) throw new Error('Not PNG');
  let pos = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    }
  }

  const compressed = Buffer.concat(idatChunks);
  const raw = inflateSync(compressed);

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;
  const rowBytes = width * channels;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const filterByte = raw[y * (rowBytes + 1)];
    const rowStart = y * (rowBytes + 1) + 1;
    const row = Buffer.alloc(rowBytes);

    for (let x = 0; x < rowBytes; x++) {
      const curr = raw[rowStart + x];
      let a = x >= channels ? row[x - channels] : 0;
      let b = y > 0 ? getDefiltered(pixels, width, channels, x, y - 1) : 0;
      let c = (x >= channels && y > 0) ? getDefiltered(pixels, width, channels, x - channels, y - 1) : 0;

      switch (filterByte) {
        case 0: row[x] = curr; break;
        case 1: row[x] = (curr + a) & 0xFF; break;
        case 2: row[x] = (curr + b) & 0xFF; break;
        case 3: row[x] = (curr + Math.floor((a + b) / 2)) & 0xFF; break;
        case 4: row[x] = (curr + paeth(a, b, c)) & 0xFF; break;
      }
    }

    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      pixels[di] = row[si];
      pixels[di + 1] = row[si + 1];
      pixels[di + 2] = row[si + 2];
      pixels[di + 3] = channels === 4 ? row[si + 3] : 255;
    }
  }

  return { width, height, pixels };
}

function getDefiltered(pixels, width, channels, x, y) {
  const px = Math.floor(x / channels);
  const ch = x % channels;
  if (ch === 3 && channels === 3) return 255;
  const idx = (y * width + px) * 4 + ch;
  return pixels[idx] || 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function fixTransparency(pixels, width, height) {
  const N = width * height;

  // Phase 1: Pure white flood-fill from borders (threshold=250)
  const outside = new Uint8Array(N);
  const queue = [];

  for (let x = 0; x < width; x++) {
    queue.push(x, 0);
    queue.push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push(0, y);
    queue.push(width - 1, y);
  }

  let qi = 0;
  while (qi < queue.length) {
    const x = queue[qi++];
    const y = queue[qi++];
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const idx = y * width + x;
    if (outside[idx]) continue;

    const pi = idx * 4;
    const r = pixels[pi], g = pixels[pi + 1], b = pixels[pi + 2];

    if (r >= 250 && g >= 250 && b >= 250) {
      outside[idx] = 1;
      queue.push(x-1,y, x+1,y, x,y-1, x,y+1, x-1,y-1, x+1,y-1, x-1,y+1, x+1,y+1);
    }
  }

  // Make outside transparent
  for (let i = 0; i < N; i++) {
    if (outside[i]) pixels[i * 4 + 3] = 0;
  }

  // Phase 2: Find and fix ALL fringe pixels iteratively.
  // A fringe pixel is opaque, adjacent to transparent, and lighter than the icon interior.
  // We find the nearest "deep inside" pixel to determine the reference color for un-blending.
  for (let pass = 0; pass < 10; pass++) {
    const changes = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const pi = idx * 4;
        if (pixels[pi + 3] === 0) continue;

        // Check if adjacent to transparent (4-connected + diagonal)
        let adjTransparent = false;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (pixels[(ny * width + nx) * 4 + 3] === 0) {
              adjTransparent = true;
              break;
            }
          }
        }
        if (!adjTransparent) continue;

        const r = pixels[pi], g = pixels[pi + 1], b = pixels[pi + 2];

        // Find nearest "deep inside" pixel (walk inward to find reference color)
        // Direction: from this pixel toward center
        const cx = width / 2, cy = height / 2;
        const dx = cx - x, dy = cy - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const stepX = dx / dist, stepY = dy / dist;

        let refR = -1, refG = -1, refB = -1;
        for (let step = 3; step <= 20; step++) {
          const sx = Math.round(x + stepX * step);
          const sy = Math.round(y + stepY * step);
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) break;
          const spi = (sy * width + sx) * 4;
          if (pixels[spi + 3] === 255) {
            const sr = pixels[spi], sg = pixels[spi + 1], sb = pixels[spi + 2];
            // Make sure it's a solid icon pixel (blue-ish, not the white JDF text)
            if (sb > 200 && sr < 80 && sg < 150) {
              refR = sr; refG = sg; refB = sb;
              break;
            }
          }
        }

        if (refR < 0) continue; // couldn't find reference, skip

        // Compute alpha: pixel = alpha * ref + (1-alpha) * 255
        // alpha = (255 - pixel) / (255 - ref)
        // Use R channel (most contrast from white)
        const alphaR = (refR < 255) ? (255 - r) / (255 - refR) : 1;
        const alphaG = (refG < 255) ? (255 - g) / (255 - refG) : 1;
        // Blue channel has least contrast (ref≈218-244, white=255) so skip it
        const alpha = Math.max(0, Math.min(1, (alphaR + alphaG) / 2));

        // Only process if this is actually a fringe pixel (alpha < 0.95)
        if (alpha >= 0.95) continue;

        const newAlpha = Math.round(alpha * 255);
        if (newAlpha < 3) {
          changes.push([pi, 0, 0, 0, 0]);
        } else {
          const a01 = newAlpha / 255;
          const origR = Math.round(Math.max(0, Math.min(255, (r - (1 - a01) * 255) / a01)));
          const origG = Math.round(Math.max(0, Math.min(255, (g - (1 - a01) * 255) / a01)));
          const origB = Math.round(Math.max(0, Math.min(255, (b - (1 - a01) * 255) / a01)));
          changes.push([pi, origR, origG, origB, newAlpha]);
        }
      }
    }

    if (changes.length === 0) break;

    for (const [pi, r, g, b, a] of changes) {
      pixels[pi] = r;
      pixels[pi + 1] = g;
      pixels[pi + 2] = b;
      pixels[pi + 3] = a;
    }
    console.log(`  pass ${pass + 1}: fixed ${changes.length} pixels`);
  }
}

function encodePNG(pixels, width, height) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowBytes)] = 0;
    pixels.copy(raw, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const compressed = deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const tp = Buffer.from(type);
    const crcBuf = Buffer.concat([tp, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf));
    return Buffer.concat([len, tp, data, crc]);
  }

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const files = ['icon.png', '32x32.png', '64x64.png', '128x128.png', '128x128@2x.png',
  'Square30x30Logo.png', 'Square44x44Logo.png', 'Square71x71Logo.png',
  'Square89x89Logo.png', 'Square107x107Logo.png', 'Square142x142Logo.png',
  'Square150x150Logo.png', 'Square284x284Logo.png', 'Square310x310Logo.png',
  'StoreLogo.png'];

for (const file of files) {
  const path = join(__dirname, file);
  try {
    const buf = readFileSync(path);
    const { width, height, pixels } = parsePNG(buf);
    console.log(`Processing ${file} (${width}x${height})...`);
    fixTransparency(pixels, width, height);
    const out = encodePNG(pixels, width, height);
    writeFileSync(path, out);
    console.log(`✓ ${file}`);
  } catch (e) {
    console.log(`✗ ${file}: ${e.message}`);
  }
}

console.log('\nDone.');
