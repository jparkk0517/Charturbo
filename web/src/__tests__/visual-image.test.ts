import { describe, expect, it } from 'vitest';
import { decodePng, diffImages, encodePng } from '../../e2e/lib/image.mjs';
import type { RgbaImage } from '../../e2e/lib/image.mjs';

/** Deterministic gradient + noise image (exercises every PNG row filter). */
function sample(width: number, height: number, seed = 1): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const p = i >> 2;
    data[i] = (i & 3) === 3 ? 255 - (p % 7) : ((p % width) * 3 + Math.floor(p / width) * 5 + (s >>> 28)) & 0xff;
  }
  return { width, height, data };
}

describe('visual harness PNG codec', () => {
  it('round-trips RGBA through encode / decode', () => {
    const img = sample(37, 23);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(37);
    expect(back.height).toBe(23);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });

  it('rejects corrupt chunks', () => {
    const bytes = encodePng(sample(4, 4));
    bytes[20] ^= 0xff; // inside IHDR: CRC mismatch
    expect(() => decodePng(bytes)).toThrow(/CRC/);
    expect(() => decodePng(new Uint8Array(16))).toThrow(/not a PNG/);
  });
});

describe('visual harness diff', () => {
  it('passes identical images and counts pixels above the threshold', () => {
    const a = sample(20, 10);
    expect(diffImages(a, a)).toMatchObject({ pass: true, diffPixels: 0, maxDelta: 0 });

    const b = { ...a, data: a.data.slice() };
    b.data[0] = (b.data[0] + 10) & 0xff; // below threshold 24
    b.data[4 * 5 + 1] = (b.data[4 * 5 + 1] + 128) & 0xff; // one differing pixel
    const d = diffImages(a, b, { threshold: 24, maxDiffRatio: 0 });
    expect(d.diffPixels).toBe(1);
    expect(d.diffRatio).toBeCloseTo(1 / 200);
    expect(d.pass).toBe(false);
    expect(Array.from(d.diff!.data.subarray(20, 24))).toEqual([255, 0, 0, 255]);
    expect(Array.from(d.diff!.data.subarray(0, 3))).toEqual([255, 200, 0]);
    expect(diffImages(a, b, { maxDiffRatio: 0.01 }).pass).toBe(true);
  });

  it('fails on a size change', () => {
    const d = diffImages(sample(4, 4), sample(4, 5));
    expect(d).toMatchObject({ pass: false, sizeMismatch: true, diff: null });
  });
});
