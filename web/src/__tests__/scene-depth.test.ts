import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../wasm-pkg/charturbo_core', () => ({
  default: vi.fn(async () => ({})),
  WasmCharturboEngine: { create: vi.fn() },
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
import { decodeDepthRange, defaultRenderPass, PACKED_DEPTH_MAX, resolveRenderPass, sendRenderPass } from '../sdk/scene-depth';

/** Backend recording the depth output calls; MSAA x4 supported. */
function depthBackend(withMethods = true) {
  const calls: Array<[string, ...number[]]> = [];
  let samples = 1;
  const backend: Record<string, unknown> = {
    free: vi.fn(),
    resize: vi.fn(),
    sync_and_render: vi.fn(),
    set_antialias: (s: number) => (samples = s === 4 ? 4 : 1),
    get_antialias: () => samples,
  };
  if (withMethods) {
    backend.set_depth_output = (e: number, n: number, f: number) => void calls.push(['set', e, n, f]);
    backend.clear_depth_output = () => void calls.push(['clear']);
    backend.get_depth_clip_planes = () => new Float32Array([0.01, 2000, 0]);
  }
  return { calls, backend: backend as unknown as WasmCharturboEngineBackend };
}

describe('depth pass validation', () => {
  it('defaults to inverse and keeps the range', () => {
    expect(resolveRenderPass('f', 'depth', { near: 50, far: 100 }, 1)).toEqual({ pass: 'depth', encoding: 'inverse', near: 50, far: 100 });
    expect(resolveRenderPass('f', 'depth', { encoding: 'linear', near: 0.5, far: 2 }, 1)).toEqual({
      pass: 'depth',
      encoding: 'linear',
      near: 0.5,
      far: 2,
    });
    expect(resolveRenderPass('f', 'beauty', undefined, 4)).toEqual(defaultRenderPass());
  });

  it('packed needs no range (0 / 0) but validates one when given', () => {
    expect(resolveRenderPass('f', 'depth', { encoding: 'packed' }, 1)).toEqual({ pass: 'depth', encoding: 'packed', near: 0, far: 0 });
    expect(resolveRenderPass('f', 'depth', { encoding: 'packed', near: 1, far: 2 }, 1).far).toBe(2);
    expect(() => resolveRenderPass('f', 'depth', { encoding: 'packed', near: 2 }, 1)).toThrow(/0 < near < far/);
  });

  it.each([
    [{}],
    [{ near: 50 }],
    [{ far: 100 }],
    [{ near: 0, far: 1 }],
    [{ near: -1, far: 1 }],
    [{ near: 2, far: 2 }],
    [{ near: 3, far: 2 }],
    [{ near: Number.NaN, far: 2 }],
    [{ near: 1, far: Number.POSITIVE_INFINITY }],
    [{ near: '1', far: 2 }],
  ])('rejects range %o for inverse / linear', (range) => {
    expect(() => resolveRenderPass('setRenderPass', 'depth', range, 1)).toThrow(/setRenderPass: near and far must be finite numbers with 0 < near < far/);
    expect(() => resolveRenderPass('setRenderPass', 'depth', { ...range, encoding: 'linear' }, 1)).toThrow(/0 < near < far/);
  });

  it('rejects bad passes, encodings, options and MSAA', () => {
    expect(() => resolveRenderPass('f', 'normal', undefined, 1)).toThrow("f: pass must be 'beauty' or 'depth' (got normal)");
    expect(() => resolveRenderPass('f', 'depth', { encoding: 'disparity', near: 1, far: 2 }, 1)).toThrow(/encoding must be 'inverse', 'linear' or 'packed'/);
    expect(() => resolveRenderPass('f', 'depth', { near: 1, far: 2, invert: true }, 1)).toThrow("f: unknown option 'invert'");
    expect(() => resolveRenderPass('f', 'depth', null, 1)).toThrow(/options must be an object/);
    expect(() => resolveRenderPass('f', 'beauty', { near: 1, far: 2 }, 1)).toThrow(/only apply to the 'depth' pass/);
    expect(() => resolveRenderPass('f', 'depth', { near: 1, far: 2 }, 4)).toThrow(
      /the depth pass needs anti-aliasing off \(getAntialias\(\) is 4\).*multisampled depth buffer; call setAntialias\(1\) first/,
    );
  });

  it('sends encoding codes and clears for beauty', () => {
    const { calls, backend } = depthBackend();
    sendRenderPass('f', backend, { pass: 'depth', encoding: 'inverse', near: 5, far: 10 });
    sendRenderPass('f', backend, { pass: 'depth', encoding: 'linear', near: 5, far: 10 });
    sendRenderPass('f', backend, { pass: 'depth', encoding: 'packed', near: 0, far: 0 });
    sendRenderPass('f', backend, defaultRenderPass());
    expect(calls).toEqual([['set', 0, 5, 10], ['set', 1, 5, 10], ['set', 2, 0, 0], ['clear']]);
    const bare = depthBackend(false).backend;
    expect(() => sendRenderPass('f', bare, { pass: 'depth', encoding: 'inverse', near: 5, far: 10 })).toThrow('f: this engine has no depth output');
    expect(() => sendRenderPass('f', bare, defaultRenderPass())).not.toThrow();
  });

  it('decodes the foreground range of packed pixels', () => {
    const px = (q: number) => [q >> 16, (q >> 8) & 255, q & 255, 255];
    const far = 2000;
    const rgba = new Uint8ClampedArray([...px(PACKED_DEPTH_MAX), ...px(0x00abcd), ...px(0x123456), ...px(PACKED_DEPTH_MAX)]);
    const r = decodeDepthRange(rgba, far)!;
    expect(r.near).toBeCloseTo((0x00abcd / PACKED_DEPTH_MAX) * far, 9);
    expect(r.far).toBeCloseTo((0x123456 / PACKED_DEPTH_MAX) * far, 9);
    expect(decodeDepthRange(new Uint8ClampedArray(px(PACKED_DEPTH_MAX)), far)).toBeNull();
  });

  it('rejects pixels that are not a presented packed frame (alpha != 255)', () => {
    expect(() => decodeDepthRange(new Uint8ClampedArray([0, 0, 0, 0]), 2000)).toThrow('alpha != 255');
  });
});

describe('Charturbo render pass', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is beauty by default and switches to depth and back', () => {
    const { calls, backend } = depthBackend();
    const sdk = Charturbo.fromBackend(backend);
    expect(sdk.getRenderPass()).toEqual({ pass: 'beauty', encoding: 'inverse', near: 0, far: 0 });
    expect(calls).toEqual([]);
    sdk.setRenderPass('depth', { near: 50, far: 100 });
    expect(sdk.getRenderPass()).toEqual({ pass: 'depth', encoding: 'inverse', near: 50, far: 100 });
    const copy = sdk.getRenderPass();
    copy.near = 1;
    expect(sdk.getRenderPass().near).toBe(50);
    sdk.setRenderPass('beauty');
    expect(sdk.getRenderPass().pass).toBe('beauty');
    expect(calls).toEqual([['set', 0, 50, 100], ['clear']]);
  });

  it('refuses the depth pass with MSAA on and MSAA during the depth pass', () => {
    const { calls, backend } = depthBackend();
    const sdk = Charturbo.fromBackend(backend);
    sdk.setAntialias(4);
    expect(() => sdk.setRenderPass('depth', { near: 50, far: 100 })).toThrow(/needs anti-aliasing off \(getAntialias\(\) is 4\)/);
    expect(sdk.getRenderPass().pass).toBe('beauty');
    sdk.setAntialias(1);
    sdk.setRenderPass('depth', { encoding: 'packed' });
    expect(() => sdk.setAntialias(4)).toThrow(/anti-aliasing must stay off during the depth pass/);
    expect(sdk.getAntialias()).toBe(1);
    sdk.setAntialias(1);
    sdk.setRenderPass('beauty');
    sdk.setAntialias(4);
    expect(sdk.getAntialias()).toBe(4);
    expect(calls).toEqual([['set', 2, 0, 0], ['clear']]);
  });

  it('keeps the previous state when the engine rejects the setting', () => {
    const { backend } = depthBackend();
    (backend as unknown as Record<string, unknown>).set_depth_output = () => {
      throw new Error('depth output needs anti-aliasing off');
    };
    const sdk = Charturbo.fromBackend(backend);
    expect(() => sdk.setRenderPass('depth', { near: 1, far: 2 })).toThrow('depth output needs anti-aliasing off');
    expect(sdk.getRenderPass().pass).toBe('beauty');
  });

  it('readDepthRange needs the packed depth pass', () => {
    const sdk = Charturbo.fromBackend(depthBackend().backend);
    expect(() => sdk.readDepthRange()).toThrow("readDepthRange: needs setRenderPass('depth', { encoding: 'packed' })");
    sdk.setRenderPass('depth', { near: 1, far: 2 });
    expect(() => sdk.readDepthRange()).toThrow(/encoding: 'packed'/);
  });
});
