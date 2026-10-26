import { beforeEach, describe, expect, it, vi } from 'vitest';

const wasm = vi.hoisted(() => ({
  init: vi.fn(async () => ({})),
  deviceCreate: vi.fn(),
  createWithDevice: vi.fn(),
  engineCreate: vi.fn(),
}));

vi.mock('../wasm-pkg/viz_core', () => ({
  default: wasm.init,
  WasmVizEngine: { create: wasm.engineCreate, create_with_device: wasm.createWithDevice },
  WasmGpuDevice: { create: wasm.deviceCreate },
}));

vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    summary(): string {
      return '';
    }
  },
}));

import { VizDevice, VizEngineSDK, VizInitError, type WasmVizEngineBackend } from '../sdk/viz-engine-sdk';

/** Rust-side `Rc` count stand-in: the handle plus one per live engine. */
function fakeDeviceHandle(backend = 'webgpu') {
  const state = { live: 0, freed: false };
  const handle = {
    backend: () => backend,
    engine_count: () => state.live,
    pipeline_sets: () => (state.live > 0 ? 1 : 0),
    free: vi.fn(() => {
      state.freed = true;
    }),
  };
  return { handle, state };
}

function fakeEngine(onFree: () => void): WasmVizEngineBackend {
  return { free: vi.fn(onFree), resize: vi.fn(), sync_and_render: vi.fn() } as unknown as WasmVizEngineBackend;
}

const canvas = {} as HTMLCanvasElement;

describe('VizDevice (shared GPU device)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests one device and creates engines on it', async () => {
    const { handle, state } = fakeDeviceHandle();
    wasm.deviceCreate.mockResolvedValue(handle);
    wasm.createWithDevice.mockImplementation(() => {
      state.live++;
      return fakeEngine(() => state.live--);
    });

    const device = await VizDevice.create({ backend: 'webgpu' });
    expect(wasm.deviceCreate).toHaveBeenCalledWith(1);
    expect(device.backend).toBe('webgpu');

    const a = await VizEngineSDK.create(canvas, { device, autoResize: false });
    const b = await VizEngineSDK.create(canvas, { device, autoResize: false, nodeCount: 50 });
    // Graph defaults are empty on the device path; explicit counts pass through
    expect(wasm.createWithDevice.mock.calls[0]).toEqual([handle, canvas, 42, 0, 0, 1]);
    expect(wasm.createWithDevice.mock.calls[1].slice(3, 4)).toEqual([50]);
    expect(wasm.engineCreate).not.toHaveBeenCalled();
    expect([device.engineCount, device.pipelineSets]).toEqual([2, 1]);

    // Disposing the last engine keeps the device for new engines
    a.dispose();
    b.dispose();
    expect(device.engineCount).toBe(0);
    expect(handle.free).not.toHaveBeenCalled();
    const c = await VizEngineSDK.create(canvas, { device, autoResize: false });
    expect(device.engineCount).toBe(1);

    // dispose(): handle freed, live engines unaffected, no new engines
    device.dispose();
    expect(handle.free).toHaveBeenCalledTimes(1);
    expect(device.disposed).toBe(true);
    expect(device.engineCount).toBe(0);
    await expect(VizEngineSDK.create(canvas, { device })).rejects.toThrow('VizDevice is disposed');
    c.dispose();
    device.dispose(); // idempotent
    expect(handle.free).toHaveBeenCalledTimes(1);
  });

  it('maps backend options and reports the WebGL2 fallback', async () => {
    const { handle } = fakeDeviceHandle('webgl2');
    wasm.deviceCreate.mockResolvedValue(handle);
    expect((await VizDevice.create()).backend).toBe('webgl2');
    await VizDevice.create({ backend: 'webgl2' });
    expect(wasm.deviceCreate.mock.calls.map((c) => c[0])).toEqual([0, 2]);
    expect(VizEngineSDK.createDevice).toBeTypeOf('function');
  });

  it('shares one module instantiation with VizEngineSDK.create', async () => {
    const { handle } = fakeDeviceHandle();
    wasm.deviceCreate.mockResolvedValue(handle);
    wasm.engineCreate.mockResolvedValue(fakeEngine(() => {}));
    // Fresh SDK modules: nothing loaded yet
    vi.resetModules();
    const sdk = await import('../sdk/viz-engine-sdk');
    await Promise.all([sdk.VizDevice.create(), sdk.VizDevice.create(), sdk.VizEngineSDK.create(canvas, { autoResize: false })]);
    expect(wasm.init).toHaveBeenCalledTimes(1);
  });

  it('classifies device and attach failures as VizInitError', async () => {
    wasm.deviceCreate.mockRejectedValueOnce('Failed to request device: OutOfMemory');
    vi.stubGlobal('navigator', { gpu: {} });
    const err = await VizDevice.create().catch((e) => e);
    vi.unstubAllGlobals();
    expect(err).toBeInstanceOf(VizInitError);
    expect(err.reason).toBe('device');

    const { handle } = fakeDeviceHandle('webgl2');
    const device = VizDevice.fromBackend(handle, () => {
      throw 'Failed to create wgpu surface: WebGL2 shared device needs a canvas without another context (2d)';
    });
    const attach = await VizEngineSDK.create(canvas, { device }).catch((e) => e);
    expect(attach).toBeInstanceOf(VizInitError);
    expect(attach.reason).toBe('no-webgpu');
    expect(attach.message).toContain('without another context');
  });
});
