// Minimal PNG codec + tolerant pixel diff for the visual regression harness (no dependencies:
// node:zlib only). Decodes 8-bit non-interlaced PNGs of every color type (Chrome screenshots are
// 8-bit RGB / RGBA); encodes 8-bit RGBA with per-row adaptive filters.

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const readU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Channels per color type (0 gray, 2 RGB, 3 palette, 4 gray + alpha, 6 RGBA). */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decodes a PNG into `{ width, height, data }` (`data`: RGBA bytes, row-major).
 * Throws on unsupported input (bit depth != 8, interlacing) or a corrupt chunk CRC.
 */
export function decodePng(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < 8; i++) if (b[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette = null;
  let trns = null;
  const idat = [];
  let o = 8;
  while (o + 12 <= b.length) {
    const len = readU32(b, o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const body = o + 8;
    if (body + len + 4 > b.length) throw new Error(`truncated ${type} chunk`);
    if (crc32(b, o + 4, body + len) !== readU32(b, body + len)) throw new Error(`bad CRC in ${type}`);
    if (type === 'IHDR') {
      width = readU32(b, body);
      height = readU32(b, body + 4);
      const depth = b[body + 8];
      colorType = b[body + 9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (!(colorType in CHANNELS)) throw new Error(`unsupported color type ${colorType}`);
      if (b[body + 12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') palette = b.subarray(body, body + len);
    else if (type === 'tRNS') trns = b.subarray(body, body + len);
    else if (type === 'IDAT') idat.push(b.subarray(body, body + len));
    else if (type === 'IEND') break;
    o = body + len + 4;
  }
  if (!width || !height) throw new Error('missing IHDR');
  const raw = inflateSync(Buffer.concat(idat));
  const ch = CHANNELS[colorType];
  const stride = width * ch;
  if (raw.length < (stride + 1) * height) throw new Error('short image data');
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0;
      const u = y > 0 ? px[up + x] : 0;
      const c = x >= ch && y > 0 ? px[up + x - ch] : 0;
      const v = raw[src + x];
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + u; break;
        case 3: out = v + ((a + u) >> 1); break;
        case 4: out = v + paeth(a, u, c); break;
        default: throw new Error(`bad filter ${filter} at row ${y}`);
      }
      px[dst + x] = out & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const d = i * 4;
    if (colorType === 6) {
      data.set(px.subarray(d, d + 4), d);
    } else if (colorType === 2) {
      data[d] = px[i * 3];
      data[d + 1] = px[i * 3 + 1];
      data[d + 2] = px[i * 3 + 2];
      data[d + 3] = 255;
    } else if (colorType === 0 || colorType === 4) {
      const g = px[i * ch];
      data[d] = data[d + 1] = data[d + 2] = g;
      data[d + 3] = colorType === 4 ? px[i * 2 + 1] : 255;
    } else {
      const k = px[i];
      if (!palette || k * 3 + 2 >= palette.length) throw new Error('palette index out of range');
      data[d] = palette[k * 3];
      data[d + 1] = palette[k * 3 + 1];
      data[d + 2] = palette[k * 3 + 2];
      data[d + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { width, height, data };
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

/** Encodes RGBA bytes as an 8-bit RGBA PNG (per-row filter with the smallest |residual| sum). */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let bestCost = Infinity;
    for (let f = 0; f <= 4; f++) {
      let cost = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? data[row + x - 4] : 0;
        const u = y > 0 ? data[row - stride + x] : 0;
        const c = x >= 4 && y > 0 ? data[row - stride + x - 4] : 0;
        const v = data[row + x];
        const r = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - u : f === 3 ? v - ((a + u) >> 1) : v - paeth(a, u, c)) & 0xff;
        trial[x] = r;
        cost += r < 128 ? r : 256 - r;
      }
      if (cost < bestCost) {
        bestCost = cost;
        raw[y * (stride + 1)] = f;
        raw.set(trial, y * (stride + 1) + 1);
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Compares two RGBA images. A pixel differs when its largest channel delta exceeds `threshold`
 * (0..255); the comparison fails when the differing fraction exceeds `maxDiffRatio` or the
 * sizes differ. Returns the counts plus a diff image: the baseline faded to gray, differing
 * pixels red, sub-threshold deltas yellow.
 */
export function diffImages(expected, actual, { threshold = 24, maxDiffRatio = 0.001 } = {}) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      pass: false,
      sizeMismatch: true,
      diffPixels: expected.width * expected.height,
      diffRatio: 1,
      maxDelta: 255,
      diff: null,
    };
  }
  const { width, height } = expected;
  const a = expected.data;
  const b = actual.data;
  const out = new Uint8Array(width * height * 4);
  let diffPixels = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
      Math.abs(a[i + 3] - b[i + 3])
    );
    if (delta > maxDelta) maxDelta = delta;
    if (delta > threshold) {
      diffPixels++;
      out[i] = 255;
      out[i + 1] = 0;
      out[i + 2] = 0;
    } else if (delta > 0) {
      out[i] = 255;
      out[i + 1] = 200;
      out[i + 2] = 0;
    } else {
      const gray = 200 + ((a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114) * 55) / 255;
      out[i] = out[i + 1] = out[i + 2] = gray;
    }
    out[i + 3] = 255;
  }
  const diffRatio = diffPixels / (width * height);
  return {
    pass: diffRatio <= maxDiffRatio,
    sizeMismatch: false,
    diffPixels,
    diffRatio,
    maxDelta,
    diff: { width, height, data: out },
  };
}
