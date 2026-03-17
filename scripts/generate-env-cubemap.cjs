#!/usr/bin/env node
/**
 * One-shot script: generates sky cube map faces.
 * Uses zlib for PNG compression (built into Node).
 *
 * Usage: node scripts/generate-env-cubemap.cjs
 * Output: textures/env/px.png, nx.png, py.png, ny.png, pz.png, nz.png
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SUN_ELEVATION = 45;
const SUN_AZIMUTH = 210;
const SIZE = 256;
const OUT_DIR = path.join(__dirname, '..', 'textures', 'env');

fs.mkdirSync(OUT_DIR, { recursive: true });

// Sun direction
const phi = (90 - SUN_ELEVATION) * Math.PI / 180;
const theta = SUN_AZIMUTH * Math.PI / 180;
const sunDir = [
  Math.sin(phi) * Math.sin(theta),
  Math.cos(phi),
  Math.sin(phi) * Math.cos(theta),
];

function skyColor(dx, dy, dz) {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  dx /= len; dy /= len; dz /= len;

  const elevation = Math.max(0, dy);
  const zenithFactor = Math.pow(elevation, 0.4);

  let skyR = 0.53 * (1 - zenithFactor * 0.3);
  let skyG = 0.81 * (1 - zenithFactor * 0.1);
  let skyB = 0.92;

  const sunDot = Math.max(0, dx * sunDir[0] + dy * sunDir[1] + dz * sunDir[2]);
  const sunGlow = Math.pow(sunDot, 32) * 0.8;
  const sunHalo = Math.pow(sunDot, 4) * 0.15;
  const horizonWarmth = Math.pow(1 - elevation, 4) * 0.12;

  let r = skyR + sunGlow + sunHalo + horizonWarmth;
  let g = skyG + sunGlow * 0.95 + sunHalo * 0.85 + horizonWarmth * 0.7;
  let b = skyB + sunGlow * 0.8 + sunHalo * 0.7;

  if (dy < 0) {
    const gf = Math.min(1, -dy * 3);
    r = r * (1 - gf) + 0.33 * gf;
    g = g * (1 - gf) + 0.42 * gf;
    b = b * (1 - gf) + 0.18 * gf;
  }

  return [
    Math.min(255, Math.max(0, Math.round(r * 255))),
    Math.min(255, Math.max(0, Math.round(g * 255))),
    Math.min(255, Math.max(0, Math.round(b * 255))),
  ];
}

// Minimal PNG writer
function writePng(width, height, rgbData) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, 'ascii');
    const crc = crc32(Buffer.concat([typeB, data]));
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, typeB, data, crcB]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT: filter byte 0 (None) per row + RGB pixels
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 3;
      const di = y * (1 + width * 3) + 1 + x * 3;
      raw[di] = rgbData[si];
      raw[di + 1] = rgbData[si + 1];
      raw[di + 2] = rgbData[si + 2];
    }
  }
  const compressed = zlib.deflateSync(raw);

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', iend)]);
}

// CRC32 for PNG chunks
const crcTable = (function() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Cube face direction mappings (OpenGL convention)
const faces = {
  px: { right: [0, 0, -1], up: [0, 1, 0], forward: [1, 0, 0] },
  nx: { right: [0, 0, 1],  up: [0, 1, 0], forward: [-1, 0, 0] },
  py: { right: [1, 0, 0],  up: [0, 0, -1], forward: [0, 1, 0] },
  ny: { right: [1, 0, 0],  up: [0, 0, 1],  forward: [0, -1, 0] },
  pz: { right: [1, 0, 0],  up: [0, 1, 0], forward: [0, 0, 1] },
  nz: { right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] },
};

for (const [name, dirs] of Object.entries(faces)) {
  const rgb = Buffer.alloc(SIZE * SIZE * 3);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / (SIZE - 1)) * 2 - 1;
      const v = -((y / (SIZE - 1)) * 2 - 1);

      const dx = dirs.forward[0] + u * dirs.right[0] + v * dirs.up[0];
      const dy = dirs.forward[1] + u * dirs.right[1] + v * dirs.up[1];
      const dz = dirs.forward[2] + u * dirs.right[2] + v * dirs.up[2];

      const [r, g, b] = skyColor(dx, dy, dz);
      const idx = (y * SIZE + x) * 3;
      rgb[idx] = r;
      rgb[idx + 1] = g;
      rgb[idx + 2] = b;
    }
  }

  const png = writePng(SIZE, SIZE, rgb);
  const outPath = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`[env] saved ${name}.png (${SIZE}x${SIZE}, ${png.length} bytes)`);
}

console.log(`[env] all 6 faces saved to ${OUT_DIR}`);
