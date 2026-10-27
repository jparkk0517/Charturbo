/**
 * Shared GPU device for many charts (dashboards, tables of sparklines).
 *
 * `Charturbo.create(canvas)` requests its own adapter + device and compiles every pipeline;
 * browsers also cap live WebGL contexts (~16), so a page of 100 charts fails. A `CharturboDevice`
 * owns one device (pipelines cached per surface format, engines start with compact buffers):
 *
 * ```ts
 * const device = await CharturboDevice.create();
 * const sdk = await Charturbo.create(canvas, { device });
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

import { WasmGpuDevice, WasmCharturboEngine } from '../wasm-pkg/charturbo_core';
// Same module instantiation promise as `Charturbo.create` (concurrent callers share it)
import { loadWasm, type WasmCharturboEngineBackend } from './charturbo';
import { CharturboInitError, classifyInitError, hasWebGl2 } from './charturbo-init';

export type CharturboDeviceBackend = 'webgpu' | 'webgl2';

export interface CharturboDeviceOptions {
  /** `'auto'` (default): WebGPU when an adapter is available, else WebGL2 */
  backend?: 'auto' | CharturboDeviceBackend;
}

/** The `WasmGpuDevice` surface used by `CharturboDevice` (mock it in tests). */
export interface WasmGpuDeviceBackend {
  backend(): string;
  engine_count(): number;
  pipeline_sets?(): number;
  free?(): void;
}

/** Builds one engine on the device (`WasmCharturboEngine.create_with_device`). */
export type CharturboDeviceEngineFactory = (
  canvas: HTMLCanvasElement,
  seed: number,
  nodeCount: number,
  edgeCount: number,
  clusterCount: number
) => WasmCharturboEngineBackend;

const BACKEND_CODE = { auto: 0, webgpu: 1, webgl2: 2 } as const;

export class CharturboDevice {
  /** Backend every engine of this device renders with */
  readonly backend: CharturboDeviceBackend;
  private handle: WasmGpuDeviceBackend | null;
  private readonly factory: CharturboDeviceEngineFactory;

  private constructor(handle: WasmGpuDeviceBackend, factory: CharturboDeviceEngineFactory) {
    this.handle = handle;
    this.factory = factory;
    this.backend = handle.backend() === 'webgl2' ? 'webgl2' : 'webgpu';
  }

  /**
   * Requests the shared adapter + device. Throws a `CharturboInitError` (`'no-webgpu'`, `'adapter'`,
   * `'device'`, `'wasm'`) like `Charturbo.create`.
   */
  static async create(options?: CharturboDeviceOptions): Promise<CharturboDevice> {
    await loadWasm();
    let handle: WasmGpuDevice;
    try {
      handle = await WasmGpuDevice.create(BACKEND_CODE[options?.backend ?? 'auto'] ?? 0);
    } catch (err) {
      const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      if (!gpu && !hasWebGl2()) {
        throw new CharturboInitError('no-webgpu', 'Neither WebGPU nor WebGL2 is available', err);
      }
      throw classifyInitError(err);
    }
    return new CharturboDevice(handle, (canvas, seed, nodes, edges, clusters) =>
      WasmCharturboEngine.create_with_device(handle, canvas, seed, nodes, edges, clusters)
    );
  }

  /** Wraps an existing device handle and engine factory (tests, custom builds). */
  static fromBackend(handle: WasmGpuDeviceBackend, factory: CharturboDeviceEngineFactory): CharturboDevice {
    return new CharturboDevice(handle, factory);
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
   * Engine backend on `canvas` (used by `Charturbo.create(canvas, { device })`). Throws a
   * `CharturboInitError` when the canvas cannot be attached, or an `Error` after `dispose()`.
   */
  createEngine(
    canvas: HTMLCanvasElement,
    options: { seed: number; nodeCount: number; edgeCount: number; clusterCount: number }
  ): WasmCharturboEngineBackend {
    if (!this.handle) throw new Error('CharturboDevice is disposed');
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
