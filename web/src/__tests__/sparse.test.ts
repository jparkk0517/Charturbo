import { describe, expect, it } from 'vitest';
import { encodeErrors, encodeImpulses } from '../sdk/chart-sparse';

describe('scientific series normalization', () => {
  it('converts symmetric and asymmetric signed errors without mutating caller arrays', () => {
    const values = [10, -5];
    const e = encodeErrors([{ name: 'E', values, error: [-2, 3] }, { name: 'A', values, errorLow: -4, errorHigh: [1, -2] }]);
    expect(e.meta.errors?.map(s => [Array.from(s.low), Array.from(s.high)])).toEqual([[[8, -8], [12, -2]], [[6, -9], [11, -3]]]);
    expect(values).toEqual([10, -5]);
    expect(e.styles[0][2]).toBeCloseTo(0.4);
    expect(e.styles[0][3]).toBe(1);
  });
  it('keeps one-sided samples when the unused endpoint is missing and gaps invalid pairs', () => {
    const values = new Float32Array([10, 20]);
    const series = { name: 'E', values, low: [NaN, 15], high: [12, NaN] };
    expect(Array.from(encodeErrors([series]).lines[0].values)).toEqual([NaN, NaN]);
    expect(Array.from(encodeErrors([{ ...series, errorMode: 'high' }]).lines[0].values)).toEqual([10, NaN]);
    expect(Array.from(values)).toEqual([10, 20]);
  });
  it('validates lengths, mixed x, coordinates and all style values before a render', () => {
    expect(() => encodeErrors([{ name: 'E', values: [1], error: [1, 2] }])).toThrow(/length/);
    expect(() => encodeImpulses([{ name: 'I', values: [1], x: [0] }, { name: 'J', values: [2] }])).toThrow(/every series/);
    expect(() => encodeImpulses([{ name: 'I', values: [1, 2], x: [2, 1] }])).toThrow(/non-decreasing/);
    expect(() => encodeImpulses([{ name: 'I', values: [1], symbolSize: -1 }])).toThrow(/symbolSize/);
    expect(() => encodeErrors([{ name: 'E', values: [1], error: 1, lineWidth: Infinity }])).toThrow(/lineWidth/);
    expect(encodeImpulses([{ name: 'I', values: [0, NaN] }]).styles[0]).toEqual(new Float32Array([0, 1, 6]));
  });
});
