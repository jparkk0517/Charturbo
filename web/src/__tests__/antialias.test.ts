import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wasm = vi.hoisted(() => ({
  init: vi.fn(async () => ({})),
  engineCreate: vi.fn(),
}));

vi.mock('../wasm-pkg/charturbo_core', () => ({
  default: wasm.init,
  WasmCharturboEngine: { create: wasm.engineCreate },
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

import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import type { CharturboAntialiasSamples } from '../sdk/antialias';

/** Backend recording `set_antialias`; `x4` mimics the device's MSAA x4 support. */
function msaaBackend(opts: { x4?: boolean; withMethod?: boolean } = {}) {
  const { x4 = true, withMethod = true } = opts;
  const calls: number[] = [];
  let applied = 1;
  const backend: Record<string, unknown> = { free: vi.fn(), resize: vi.fn(), sync_and_render: vi.fn() };
  if (withMethod) {
    backend.set_antialias = (samples: number) => {
      calls.push(samples);
      applied = samples === 4 && x4 ? 4 : 1;
      return applied;
    };
    backend.get_antialias = () => applied;
  }
  return { calls, backend: backend as unknown as WasmCharturboEngineBackend };
}

const canvas = {} as HTMLCanvasElement;

describe('anti-aliasing (MSAA)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('is off by default and never touches the backend', async () => {
    const { calls, backend } = msaaBackend();
    wasm.engineCreate.mockResolvedValue(backend);
    const sdk = await Charturbo.create(canvas, { autoResize: false });
    expect(sdk.getAntialias()).toBe(1);
    expect(calls).toEqual([]);
    expect(Charturbo.fromBackend(backend).getAntialias()).toBe(1);
  });

  it('applies the create option (true = 4, false = off)', async () => {
    for (const [option, sent, applied] of [
      [true, [4], 4],
      [4, [4], 4],
      [1, [1], 1],
      [false, [1], 1],
    ] as const) {
      const { calls, backend } = msaaBackend();
      wasm.engineCreate.mockResolvedValue(backend);
      const sdk = await Charturbo.create(canvas, { autoResize: false, antialias: option });
      expect(calls).toEqual(sent);
      expect(sdk.getAntialias()).toBe(applied);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects an invalid create option before any engine exists', async () => {
    await expect(
      Charturbo.create(canvas, { autoResize: false, antialias: 2 as unknown as 4 })
    ).rejects.toThrow('create: antialias must be');
    expect(wasm.init).not.toHaveBeenCalled();
    expect(wasm.engineCreate).not.toHaveBeenCalled();
  });

  it('setAntialias switches at runtime and validates', () => {
    const { calls, backend } = msaaBackend();
    const sdk = Charturbo.fromBackend(backend);
    sdk.setAntialias(4);
    expect(sdk.getAntialias()).toBe(4);
    sdk.setAntialias(1);
    expect(sdk.getAntialias()).toBe(1);
    for (const bad of [0, 2, 8, true, '4', Number.NaN]) {
      expect(() => sdk.setAntialias(bad as unknown as CharturboAntialiasSamples)).toThrow('setAntialias: samples must be 1 or 4');
    }
    expect(calls).toEqual([4, 1]);
    expect(sdk.getAntialias()).toBe(1);
  });

  it('falls back to 1 with a console warning without device support', async () => {
    const { calls, backend } = msaaBackend({ x4: false });
    wasm.engineCreate.mockResolvedValue(backend);
    const sdk = await Charturbo.create(canvas, { autoResize: false, antialias: true });
    expect(calls).toEqual([4]);
    expect(sdk.getAntialias()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('MSAA x4 is not supported');
    sdk.setAntialias(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on a backend without the method', () => {
    const { backend } = msaaBackend({ withMethod: false });
    const sdk = Charturbo.fromBackend(backend);
    expect(() => sdk.setAntialias(4)).not.toThrow();
    expect(sdk.getAntialias()).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
