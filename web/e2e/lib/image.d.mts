/** RGBA8 image, row-major. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface DiffOptions {
  /** Largest channel delta (0..255) still counted as equal (default 24) */
  threshold?: number;
  /** Fraction of differing pixels that still passes (default 0.001) */
  maxDiffRatio?: number;
}

export interface DiffResult {
  pass: boolean;
  sizeMismatch: boolean;
  diffPixels: number;
  diffRatio: number;
  maxDelta: number;
  /** Baseline faded to gray, differing pixels red, sub-threshold deltas yellow (null on size mismatch) */
  diff: RgbaImage | null;
}

export function decodePng(bytes: Uint8Array | ArrayBuffer): RgbaImage;
export function encodePng(image: RgbaImage): Uint8Array;
export function diffImages(expected: RgbaImage, actual: RgbaImage, options?: DiffOptions): DiffResult;
