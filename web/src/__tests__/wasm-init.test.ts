import { describe, expect, it, vi } from 'vitest';

// Module load counter: resolves on the next macrotask, like a fetch + instantiate
const load = vi.hoisted(() => ({ calls: 0, fail: false }));
vi.mock('../wasm-pkg/charturbo_core', () => ({
  default: () => {
    load.calls++;
    return new Promise((resolve, reject) => setTimeout(() => (load.fail ? reject(new Error('404')) : resolve({})), 0));
  },
  WasmCharturboEngine: { create: async () => ({ free() {} }) },
}));

import { Charturbo, CharturboInitError } from '../sdk/charturbo';

const canvas = () => ({ clientWidth: 100, clientHeight: 50, width: 0, height: 0, style: {} }) as unknown as HTMLCanvasElement;

describe('wasm module init', () => {
  it('a failed load can be retried; concurrent create() calls then share one load', async () => {
    load.fail = true;
    await expect(Charturbo.create(canvas(), { autoResize: false })).rejects.toBeInstanceOf(CharturboInitError);
    expect(load.calls).toBe(1);

    load.fail = false;
    const sdks = await Promise.all([1, 2, 3].map(() => Charturbo.create(canvas(), { autoResize: false })));
    expect(sdks).toHaveLength(3);
    // One more load for all three (a second instantiation would break engines created by the first)
    expect(load.calls).toBe(2);
    await Charturbo.create(canvas(), { autoResize: false });
    expect(load.calls).toBe(2);
  });
});
