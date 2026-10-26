/**
 * Engine start-up helpers: capability check, typed init errors, and canvas auto-resize
 * (ResizeObserver + device-pixel-ratio changes).
 */

export type VizInitErrorReason = 'no-webgpu' | 'adapter' | 'device' | 'wasm';

/**
 * Thrown by `VizEngineSDK.create`. `reason`: `'no-webgpu'` neither WebGPU nor WebGL2 is
 * available (or the canvas surface could not be created), `'adapter'` no suitable GPU adapter,
 * `'device'` the adapter refused a device, `'wasm'` the WebAssembly module failed to load.
 */
export class VizInitError extends Error {
  readonly reason: VizInitErrorReason;

  constructor(reason: VizInitErrorReason, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'VizInitError';
    this.reason = reason;
  }
}

/** Maps an engine start-up failure (string messages from `WgpuRenderBackend::from_canvas`). */
export function classifyInitError(err: unknown): VizInitError {
  if (err instanceof VizInitError) return err;
  const message = err instanceof Error ? err.message : String(err);
  // A trap / panic inside the module (not a GPU refusal)
  if (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) {
    return new VizInitError('wasm', message, err);
  }
  const reason: VizInitErrorReason = message.startsWith('Failed to request device')
    ? 'device'
    : message.startsWith('Failed to create wgpu surface')
      ? 'no-webgpu'
      : 'adapter';
  return new VizInitError(reason, message, err);
}

interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

/** WebGPU adapter available (`navigator.gpu.requestAdapter()` resolves non-null). */
export async function hasWebGpuAdapter(): Promise<boolean> {
  const gpu = (typeof navigator !== 'undefined' ? (navigator as { gpu?: GpuLike }).gpu : undefined) ?? null;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/** A WebGL2 context can be created (the engine's wgpu GL fallback). */
export function hasWebGl2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** WebGPU (preferred) or the WebGL2 fallback can drive the engine. */
export async function isRenderingSupported(): Promise<boolean> {
  return (await hasWebGpuAdapter()) || hasWebGl2();
}

/** Backing-store cap per side (WebGPU's default `maxTextureDimension2D`). */
const MAX_CANVAS_PX = 8192;

/**
 * Keeps `canvas.width` / `height` at its CSS box x device pixel ratio. Uses
 * `device-pixel-content-box` when the browser reports it (exact pixel snapping), else
 * `content-box` x `devicePixelRatio`; a `matchMedia` resolution query catches zoom / monitor
 * changes that do not resize the CSS box. `onResize` runs only when the pixel size changes.
 * Sizes are capped at 8192 px per side (aspect kept). A canvas without a CSS size (its box
 * follows the `width` / `height` attributes) would grow on every resize: the first such
 * feedback pins its CSS size to the box it had.
 * Returns the disconnect function (no-op without `ResizeObserver`).
 */
export function observeCanvasPixelSize(
  canvas: HTMLCanvasElement,
  onResize: (width: number, height: number) => void
): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const dpr = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  let css = { width: canvas.clientWidth, height: canvas.clientHeight };
  /** The observer reports device pixels, so it already fires on DPR changes */
  let deviceBox = false;

  /** Backing size last written (feedback detection) */
  let applied: { width: number; height: number } | null = null;

  const apply = (width: number, height: number) => {
    const scale = Math.min(1, MAX_CANVAS_PX / Math.max(width, height, 1));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    applied = { width, height };
    onResize(width, height);
  };

  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    const box = entry.contentBoxSize?.[0];
    const prev = css;
    css = box ? { width: box.inlineSize, height: box.blockSize } : entry.contentRect;
    // CSS box now equals the backing size just written: it follows the attributes (no CSS
    // size), so pin it instead of growing again
    if (
      applied &&
      Math.round(css.width) === applied.width &&
      Math.round(css.height) === applied.height &&
      (Math.round(prev.width) !== applied.width || Math.round(prev.height) !== applied.height)
    ) {
      canvas.style.width = `${prev.width}px`;
      canvas.style.height = `${prev.height}px`;
      css = prev;
      applied = null;
      return;
    }
    const device = entry.devicePixelContentBoxSize?.[0];
    deviceBox = !!device;
    if (device) apply(device.inlineSize, device.blockSize);
    else apply(css.width * dpr(), css.height * dpr());
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    // Older Safari: the box option is unsupported
    observer.observe(canvas, { box: 'content-box' });
  }

  // DPR changes (zoom, moving to another display): one query per ratio, re-armed on change
  let media: MediaQueryList | null = null;
  const onDprChange = () => {
    if (!deviceBox) apply(css.width * dpr(), css.height * dpr());
    watchDpr();
  };
  const watchDpr = () => {
    media?.removeEventListener('change', onDprChange);
    media = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${dpr()}dppx)`) : null;
    media?.addEventListener('change', onDprChange);
  };
  watchDpr();

  return () => {
    observer.disconnect();
    media?.removeEventListener('change', onDprChange);
    media = null;
  };
}
