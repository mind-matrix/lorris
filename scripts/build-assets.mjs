// Builds the card sprite atlas and the PWA icons from assets/*.png.
// Zero dependencies: a minimal PNG decoder/encoder on top of node:zlib.
//
//   node scripts/build-assets.mjs
//
// Outputs:
//   src/ui/assets/cards.png            one atlas with every card the game can use + the back
//   src/ui/cardAtlas.generated.ts      card id -> atlas cell mapping
//   public/icons/*.png                 app icons (any + maskable), apple touch icon, favicon

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'assets');

// ---------- PNG decode / encode (8-bit RGB/RGBA, non-interlaced) ----------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Returns { width, height, data } with data as RGBA bytes. */
function decodePng(file) {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      colorType = body[9];
      const interlace = body[12];
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
        throw new Error(`${file}: only 8-bit non-interlaced RGB/RGBA PNGs are supported`);
      }
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      out[x] = filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c);
    }
  }
  if (bpp === 4) return { width, height, data: pixels };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * 3];
    rgba[i * 4 + 1] = pixels[i * 3 + 1];
    rgba[i * 4 + 2] = pixels[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, data: rgba };
}

function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    // Pick the filter with the smallest sum of absolute values (standard heuristic).
    let bestFilter = 0, bestScore = Infinity, best = null;
    for (let f = 0; f <= 4; f++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? line[x - 4] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= 4 ? prev[x - 4] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (line[x] - pred) & 0xff;
        candidate[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        best = Buffer.from(candidate);
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    best.copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Image helpers ----------

function blank(width, height, rgba = [0, 0, 0, 0]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

/** Area-average resize with premultiplied alpha (no dark fringes on transparent edges). */
function resize(src, width, height) {
  const out = blank(width, height);
  const sx = src.width / width, sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          const alpha = src.data[i + 3];
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
      }
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Alpha-composites `src` onto `dst` at (dx, dy). */
function draw(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x, ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      const s = (y * src.width + x) * 4, d = (ty * dst.width + tx) * 4;
      const sa = src.data[s + 3] / 255, da = dst.data[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) continue;
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round((src.data[s + c] * sa + dst.data[d + c] * da * (1 - sa)) / oa);
      }
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

// ---------- Atlas ----------

// Every card any supported player count can use: ranks 3..A (6 players), minus 3S, plus the Joker.
const SUITS = { S: 'spade', H: 'heart', D: 'diamond', C: 'club' };
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const assetRank = (label) => ({ J: 11, Q: 12, K: 13, A: 1 })[label] ?? Number(label);

const entries = [];
for (const [suit, name] of Object.entries(SUITS)) {
  for (const rank of RANKS) {
    if (suit === 'S' && rank === '3') continue;
    entries.push({ id: `${rank}${suit}`, file: `simplecard_${name}_${assetRank(rank)}.png` });
  }
}
entries.push({ id: 'JK', file: 'simplecard_joker_mixed.png' });
entries.push({ id: 'back', file: 'blue_back_intricate.png' });

// Source cards are 800x1080; a quarter of that (200x270) is sharp at ~70 CSS px on 3x screens.
const CELL_W = 200, CELL_H = 270;
const COLS = Math.ceil(Math.sqrt(entries.length));
const ROWS = Math.ceil(entries.length / COLS);
const atlas = blank(COLS * CELL_W, ROWS * CELL_H);
const images = {};
entries.forEach(({ id, file }, i) => {
  const img = decodePng(join(assetsDir, file));
  images[id] = img;
  draw(atlas, resize(img, CELL_W, CELL_H), (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H);
});

mkdirSync(join(root, 'src/ui/assets'), { recursive: true });
const atlasPng = encodePng(atlas);
writeFileSync(join(root, 'src/ui/assets/cards.png'), atlasPng);

const index = Object.fromEntries(entries.map((e, i) => [e.id, i]));
writeFileSync(
  join(root, 'src/ui/cardAtlas.generated.ts'),
  `// Generated by scripts/build-assets.mjs. Do not edit.\n` +
    `export const ATLAS = ${JSON.stringify({ cols: COLS, rows: ROWS, cellWidth: CELL_W, cellHeight: CELL_H })} as const;\n` +
    `export const ATLAS_INDEX: Record<string, number> = ${JSON.stringify(index)};\n`,
);

// ---------- Icons ----------

// A Joker card in front of a card back, offset like a small fan, on table-green.
const FELT = [22, 101, 66, 255];
function icon(size, { maskable }) {
  const img = blank(size, size, FELT);
  // Maskable icons must keep content inside the central 80% safe zone.
  const cardH = Math.round(size * (maskable ? 0.56 : 0.7));
  const cardW = Math.round((cardH * 800) / 1080);
  const back = resize(images.back, cardW, cardH);
  const joker = resize(images.JK, cardW, cardH);
  const cx = Math.round(size / 2), cy = Math.round(size / 2);
  const shift = Math.round(cardW * 0.18);
  draw(img, back, cx - Math.round(cardW / 2) - shift, cy - Math.round(cardH / 2) - shift);
  draw(img, joker, cx - Math.round(cardW / 2) + shift, cy - Math.round(cardH / 2) + shift);
  return encodePng(img);
}

mkdirSync(join(root, 'public/icons'), { recursive: true });
const icons = {
  'icon-192.png': icon(192, { maskable: false }),
  'icon-512.png': icon(512, { maskable: false }),
  'maskable-512.png': icon(512, { maskable: true }),
  'apple-touch-icon-180.png': icon(180, { maskable: true }),
  'favicon-64.png': icon(64, { maskable: false }),
};
for (const [name, png] of Object.entries(icons)) writeFileSync(join(root, 'public/icons', name), png);

console.log(`atlas: ${entries.length} cells, ${COLS}x${ROWS}, ${atlas.width}x${atlas.height}px, ${(atlasPng.length / 1024).toFixed(0)} KiB`);
console.log(`icons: ${Object.keys(icons).join(', ')}`);
