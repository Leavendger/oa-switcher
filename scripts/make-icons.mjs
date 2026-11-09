import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(repoRoot, 'public', 'icons');

const BG = [15, 23, 42];
const CARD = [30, 41, 59];
const ACCENT = [56, 189, 248];
const LIGHT = [226, 232, 240];

function insideRoundedRect(x, y, min, max, r) {
  if (x < min || x > max || y < min || y > max) return false;
  const qx = Math.min(Math.max(x, min + r), max - r);
  const qy = Math.min(Math.max(y, min + r), max - r);
  const dx = x - qx;
  const dy = y - qy;
  return dx * dx + dy * dy <= r * r;
}

function inArrow(x, y, x0, x1, yc, dir) {
  const nx = dir === 1 ? x : 1 - x;
  const headW = 0.1;
  const headH = 0.12;
  const shaftH = 0.036;
  if (y < yc - headH || y > yc + headH) return false;
  if (nx < x0 || nx > x1) return false;
  if (nx <= x1 - headW) {
    return Math.abs(y - yc) <= shaftH;
  }
  const p = (nx - (x1 - headW)) / headW;
  return Math.abs(y - yc) <= headH * (1 - p);
}

function sampleColor(x, y) {
  if (!insideRoundedRect(x, y, 0.02, 0.98, 0.22)) return null;
  if (!insideRoundedRect(x, y, 0.1, 0.9, 0.16)) {
    return CARD;
  }
  if (inArrow(x, y, 0.22, 0.74, 0.4, 1)) return ACCENT;
  if (inArrow(x, y, 0.26, 0.78, 0.62, -1)) return LIGHT;
  return BG;
}

function render(size) {
  const ss = 4;
  const w = size * ss;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          const c = sampleColor(x, y);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            n += 1;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (n === 0) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      } else {
        out[i] = Math.round(r / n);
        out[i + 1] = Math.round(g / n);
        out[i + 2] = Math.round(b / n);
        out[i + 3] = 255;
      }
    }
  }
  return out;
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, render(size));
  await writeFile(path.join(outDir, `icon-${size}.png`), png);
  console.log(`[icons] icon-${size}.png (${png.length} bytes)`);
}
