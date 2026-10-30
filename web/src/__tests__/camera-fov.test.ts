// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Charturbo } from '../sdk/charturbo';
import { graphBackend } from './graph-backend';

describe('setCameraFov', () => {
  it('forwards degrees to the backend', () => {
    const { backend } = graphBackend();
    const got: number[] = [];
    backend.set_camera_fov = (d) => void got.push(d);
    Charturbo.fromBackend(backend).setCameraFov(60);
    expect(got).toEqual([60]);
  });

  it('rejects non-finite values with a prefixed error', () => {
    const { backend } = graphBackend();
    const sdk = Charturbo.fromBackend(backend);
    for (const bad of [NaN, Infinity, -Infinity, '60' as unknown as number]) {
      expect(() => sdk.setCameraFov(bad)).toThrow(/^setCameraFov: /);
    }
  });

  it('is a no-op on backends without the binding', () => {
    const { backend } = graphBackend();
    expect(() => Charturbo.fromBackend(backend).setCameraFov(50)).not.toThrow();
  });
});
