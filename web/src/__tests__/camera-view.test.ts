// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Charturbo } from '../sdk/charturbo';
import { graphBackend } from './graph-backend';

function setup(ret = true) {
  const { backend } = graphBackend();
  const calls: number[][] = [];
  backend.set_camera_view = (...a: number[]) => {
    calls.push(a);
    return ret;
  };
  return { backend, calls, sdk: Charturbo.fromBackend(backend) };
}

describe('setCameraView', () => {
  it('forwards exact values and returns the engine result', () => {
    const { calls, sdk } = setup();
    expect(sdk.setCameraView({ eye: [1, 2, 3], target: [4, 5, 6], up: [0, 0, 1], roll: 0.5 })).toBe(true);
    expect(calls).toEqual([[1, 2, 3, 4, 5, 6, 0, 0, 1, 0.5]]);
  });

  it('defaults up to (0,0,0) and roll to 0', () => {
    const { calls, sdk } = setup();
    sdk.setCameraView({ eye: [0, 0, 9000], target: [0, 0, 0] });
    expect(calls).toEqual([[0, 0, 9000, 0, 0, 0, 0, 0, 0, 0]]);
  });

  it('returns false when the engine rejects (eye == target)', () => {
    const { sdk } = setup(false);
    expect(sdk.setCameraView({ eye: [1, 1, 1], target: [1, 1, 1] })).toBe(false);
  });

  it('refreshes the overview distance from camera_state on success only', () => {
    const { backend, sdk } = setup();
    let dist = 100;
    backend.camera_state = () => new Float32Array([0, 0, 0, dist, 0, 0, 0.8, 1]);
    sdk.setCameraView({ eye: [0, 0, 100], target: [0, 0, 0] });
    expect((sdk as unknown as { overviewDistance: number | null }).overviewDistance).toBe(dist);
    dist = 7;
    const s2 = setup(false);
    s2.backend.camera_state = backend.camera_state;
    s2.sdk.setCameraView({ eye: [0, 0, 7], target: [0, 0, 0] });
    expect((s2.sdk as unknown as { overviewDistance: number | null }).overviewDistance).not.toBe(7);
  });

  it('falls back to set_camera_pose and returns false without the binding', () => {
    const { backend } = graphBackend();
    const got: number[][] = [];
    backend.set_camera_pose = (...a: number[]) => void got.push(a);
    const sdk = Charturbo.fromBackend(backend);
    expect(sdk.setCameraView({ eye: [1, 2, 3], target: [4, 5, 6] })).toBe(false);
    expect(got).toEqual([[1, 2, 3, 4, 5, 6]]);
  });

  it('throws prefixed errors on invalid input without calling the backend', () => {
    const { calls, sdk } = setup();
    const bad: unknown[] = [
      { eye: [NaN, 0, 0], target: [0, 0, 0] },
      { eye: [0, 0], target: [0, 0, 0] },
      { eye: [0, 0, 0], target: [Infinity, 0, 0] },
      { eye: [0, 0, 1], target: [0, 0, 0], up: [0, 'a', 0] },
      { eye: [0, 0, 1], target: [0, 0, 0], roll: NaN },
      { eye: [0, 0, 1] },
      null,
    ];
    for (const v of bad) expect(() => sdk.setCameraView(v as never)).toThrow(/^setCameraView: /);
    expect(calls).toEqual([]);
  });
});
