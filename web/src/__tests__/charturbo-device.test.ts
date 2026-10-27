import { beforeEach, describe, expect, it, vi } from 'vitest';

const wasm = vi.hoisted(() => ({
  init: vi.fn(async () => ({})),
  deviceCreate: vi.fn(),
  createWithDevice: vi.fn(),
  engineCreate: vi.fn(),
}));

vi.mock('../wasm-pkg/charturbo_core', () => ({
  default: wasm.init,
  WasmCharturboEngine: { create: wasm.engineCreate, create_with_device: wasm.createWithDevice },
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

import { CharturboDevice, Charturbo, CharturboInitError, type WasmCharturboEngineBackend } from '../sdk/charturbo';

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

function fakeEngine(onFree: () => void): WasmCharturboEngineBackend {
  return { free: vi.fn(onFree), resize: vi.fn(), sync_and_render: vi.fn() } as unknown as WasmCharturboEngineBackend;
}

const canvas = {} as HTMLCanvasElement;

describe('CharturboDevice (shared GPU device)', () => {
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

    const device = await CharturboDevice.create({ backend: 'webgpu' });
    expect(wasm.deviceCreate).toHaveBeenCalledWith(1);
    expect(device.backend).toBe('webgpu');

    const a = await Charturbo.create(canvas, { device, autoResize: false });
    const b = await Charturbo.create(canvas, { device, autoResize: false, nodeCount: 50 });
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
    const c = await Charturbo.create(canvas, { device, autoResize: false });
    expect(device.engineCount).toBe(1);

    // dispose(): handle freed, live engines unaffected, no new engines
    device.dispose();
    expect(handle.free).toHaveBeenCalledTimes(1);
    expect(device.disposed).toBe(true);
    expect(device.engineCount).toBe(0);
    await expect(Charturbo.create(canvas, { device })).rejects.toThrow('CharturboDevice is disposed');
    c.dispose();
    device.dispose(); // idempotent
    expect(handle.free).toHaveBeenCalledTimes(1);
  });

  it('maps backend options and reports the WebGL2 fallback', async () => {
    const { handle } = fakeDeviceHandle('webgl2');
    wasm.deviceCreate.mockResolvedValue(handle);
    expect((await CharturboDevice.create()).backend).toBe('webgl2');
    await CharturboDevice.create({ backend: 'webgl2' });
    expect(wasm.deviceCreate.mock.calls.map((c) => c[0])).toEqual([0, 2]);
    expect(Charturbo.createDevice).toBeTypeOf('function');
  });

  it('shares one module instantiation with Charturbo.create', async () => {
    const { handle } = fakeDeviceHandle();
    wasm.deviceCreate.mockResolvedValue(handle);
    wasm.engineCreate.mockResolvedValue(fakeEngine(() => {}));
    // Fresh SDK modules: nothing loaded yet
    vi.resetModules();
    const sdk = await import('../sdk/charturbo');
    await Promise.all([sdk.CharturboDevice.create(), sdk.CharturboDevice.create(), sdk.Charturbo.create(canvas, { autoResize: false })]);
    expect(wasm.init).toHaveBeenCalledTimes(1);
  });

  it('classifies device and attach failures as CharturboInitError', async () => {
    wasm.deviceCreate.mockRejectedValueOnce('Failed to request device: OutOfMemory');
    vi.stubGlobal('navigator', { gpu: {} });
    const err = await CharturboDevice.create().catch((e) => e);
    vi.unstubAllGlobals();
    expect(err).toBeInstanceOf(CharturboInitError);
    expect(err.reason).toBe('device');

    const { handle } = fakeDeviceHandle('webgl2');
    const device = CharturboDevice.fromBackend(handle, () => {
      throw 'Failed to create wgpu surface: WebGL2 shared device needs a canvas without another context (2d)';
    });
    const attach = await Charturbo.create(canvas, { device }).catch((e) => e);
    expect(attach).toBeInstanceOf(CharturboInitError);
    expect(attach.reason).toBe('no-webgpu');
    expect(attach.message).toContain('without another context');
  });
});
