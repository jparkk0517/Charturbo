import { beforeEach, describe, expect, it, vi } from 'vitest';

// Records the argument of each module load (wasm-bindgen `__wbg_init`)
const load = vi.hoisted(() => ({ args: [] as unknown[], fail: false }));
vi.mock('../wasm-pkg/viz_core', () => ({
  default: (arg?: unknown) => {
    load.args.push(arg);
    return load.fail ? Promise.reject(new Error('404')) : Promise.resolve({});
  },
  WasmVizEngine: { create: async () => ({ free() {} }) },
}));

/** Fresh SDK module per test: the loaded-once state is module-level. */
async function sdkModule() {
  vi.resetModules();
  return import('../sdk/viz-engine-sdk');
}

describe('setWasmSource', () => {
  beforeEach(() => {
    load.args = [];
    load.fail = false;
  });

  it('default: wasm-bindgen resolves the module next to the ES chunk (no argument)', async () => {
    const { loadWasm } = await sdkModule();
    await loadWasm();
    expect(load.args).toEqual([undefined]);
  });

  it('passes the source as { module_or_path } and is ignored once loaded', async () => {
    const { loadWasm, setWasmSource } = await sdkModule();
    setWasmSource('https://cdn.example/viz_core_bg.wasm');
    await loadWasm();
    setWasmSource('https://other.example/x.wasm');
    await loadWasm();
    expect(load.args).toEqual([{ module_or_path: 'https://cdn.example/viz_core_bg.wasm' }]);
  });

  it('lazy source resolves on the first load only, and again on a retry after a failure', async () => {
    const { loadWasm, setWasmSourceLazy, VizInitError } = await sdkModule();
    const bytes = new Uint8Array([0, 97, 115, 109]);
    const resolve = vi.fn(() => bytes);
    setWasmSourceLazy(resolve);
    expect(resolve).not.toHaveBeenCalled(); // not at import / registration

    load.fail = true;
    await expect(loadWasm()).rejects.toBeInstanceOf(VizInitError);
    load.fail = false;
    await loadWasm();
    await loadWasm();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(load.args).toEqual([{ module_or_path: bytes }, { module_or_path: bytes }]);
  });
});
