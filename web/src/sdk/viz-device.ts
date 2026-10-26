/**
 * Shared GPU device for many charts (dashboards, tables of sparklines).
 *
 * `VizEngineSDK.create(canvas)` requests its own adapter + device and compiles every pipeline;
 * browsers also cap live WebGL contexts (~16), so a page of 100 charts fails. A `VizDevice`
 * owns one device (pipelines cached per surface format, engines start with compact buffers):
 *
 * ```ts
 * const device = await VizDevice.create();
 * const sdk = await VizEngineSDK.create(canvas, { device });
 * ```
 *
 * WebGPU: each canvas gets its own surface on the shared device. WebGL2 (fallback): one GL
 * context renders every engine into a hidden shared canvas and copies the frame into the
 * engine's canvas with a 2D `drawImage` — engine canvases then use a `2d` context, so pass
 * fresh canvases (never one that already has a `webgl2` / `webgpu` context).
 *
 * Lifetime: engines keep the device alive. Disposing the last engine keeps it for new engines;
 * `device.dispose()` releases the handle (engines still alive keep working, the GPU device is
 * freed when they are disposed too) and further `create(canvas, { device })` calls throw.
 */

import { WasmGpuDevice, WasmVizEngine } from '../wasm-pkg/viz_core';
// Same module instantiation promise as `VizEngineSDK.create` (concurrent callers share it)
import { loadWasm, type WasmVizEngineBackend } from './viz-engine-sdk';
import { VizInitError, classifyInitError, hasWebGl2 } from './viz-init';

export type VizDeviceBackend = 'webgpu' | 'webgl2';

export interface VizDeviceOptions {
  /** `'auto'` (default): WebGPU when an adapter is available, else WebGL2 */
  backend?: 'auto' | VizDeviceBackend;
}

/** The `WasmGpuDevice` surface used by `VizDevice` (mock it in tests). */
export interface WasmGpuDeviceBackend {
  backend(): string;
  engine_count(): number;
  pipeline_sets?(): number;
  free?(): void;
}

/** Builds one engine on the device (`WasmVizEngine.create_with_device`). */
export type VizDeviceEngineFactory = (
  canvas: HTMLCanvasElement,
  seed: number,
  nodeCount: number,
  edgeCount: number,
  clusterCount: number
) => WasmVizEngineBackend;

const BACKEND_CODE = { auto: 0, webgpu: 1, webgl2: 2 } as const;

export class VizDevice {
  /** Backend every engine of this device renders with */
  readonly backend: VizDeviceBackend;
  private handle: WasmGpuDeviceBackend | null;
  private readonly factory: VizDeviceEngineFactory;

  private constructor(handle: WasmGpuDeviceBackend, factory: VizDeviceEngineFactory) {
    this.handle = handle;
    this.factory = factory;
    this.backend = handle.backend() === 'webgl2' ? 'webgl2' : 'webgpu';
  }

  /**
   * Requests the shared adapter + device. Throws a `VizInitError` (`'no-webgpu'`, `'adapter'`,
   * `'device'`, `'wasm'`) like `VizEngineSDK.create`.
   */
  static async create(options?: VizDeviceOptions): Promise<VizDevice> {
    await loadWasm();
    let handle: WasmGpuDevice;
    try {
      handle = await WasmGpuDevice.create(BACKEND_CODE[options?.backend ?? 'auto'] ?? 0);
    } catch (err) {
      const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      if (!gpu && !hasWebGl2()) {
        throw new VizInitError('no-webgpu', 'Neither WebGPU nor WebGL2 is available', err);
      }
      throw classifyInitError(err);
    }
    return new VizDevice(handle, (canvas, seed, nodes, edges, clusters) =>
      WasmVizEngine.create_with_device(handle, canvas, seed, nodes, edges, clusters)
    );
  }

  /** Wraps an existing device handle and engine factory (tests, custom builds). */
  static fromBackend(handle: WasmGpuDeviceBackend, factory: VizDeviceEngineFactory): VizDevice {
    return new VizDevice(handle, factory);
  }

  /** `dispose()` was called: no new engines. */
  get disposed(): boolean {
    return this.handle === null;
  }

  /** Engines currently alive on this device (0 after `dispose()`). */
  get engineCount(): number {
    return this.handle?.engine_count() ?? 0;
  }

  /** Pipeline sets compiled (one per surface format, however many engines). */
  get pipelineSets(): number {
    return this.handle?.pipeline_sets?.() ?? 0;
  }

  /**
   * Engine backend on `canvas` (used by `VizEngineSDK.create(canvas, { device })`). Throws a
   * `VizInitError` when the canvas cannot be attached, or an `Error` after `dispose()`.
   */
  createEngine(
    canvas: HTMLCanvasElement,
    options: { seed: number; nodeCount: number; edgeCount: number; clusterCount: number }
  ): WasmVizEngineBackend {
    if (!this.handle) throw new Error('VizDevice is disposed');
    try {
      return this.factory(canvas, options.seed, options.nodeCount, options.edgeCount, options.clusterCount);
    } catch (err) {
      throw classifyInitError(err);
    }
  }

  /** Releases this handle (see the module docs: live engines keep the GPU device until disposed). */
  dispose(): void {
    this.handle?.free?.();
    this.handle = null;
  }
}
