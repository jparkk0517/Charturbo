import { describe, expect, it } from 'vitest';
import { metricValue, rowsFor, type Entry, type Results } from '../../bench/report-model';

const valid = (lib = 'viz'): Entry => ({
  lib, scenario: 'line-1m-1s', ok: true,
  result: { backend: 'webgpu', ttff: { frame: { median: 12, n: 5 } }, steady: { fps: 0 } },
});

describe('benchmark report measurement integrity', () => {
  it('keeps a real zero but never turns failure, missing data or NaN into zero', () => {
    expect(metricValue(valid(), 'fps').value).toBe(0);
    expect(metricValue(undefined, 'fps')).toEqual({ value: null, status: '미측정' });
    expect(metricValue({ ...valid(), ok: false, error: 'timeout after 300 s' }, 'fps')).toEqual({ value: null, status: '시간 초과' });
    const bad = valid(); bad.result!.steady.fps = NaN;
    expect(metricValue(bad, 'fps').value).toBeNull();
  });
  it('excludes historical SciChart redraw-only TTFF, but accepts corrected data-copy measurements', () => {
    const r = valid('scichart');
    expect(metricValue(r, 'ttff').value).toBeNull();
    expect(metricValue(r, 'fps').value).toBe(0);
    r.result!.methodologyVersion = 2;
    expect(metricValue(r, 'ttff').value).toBe(12);
  });
  it('requires proof of one physics tick and moving nodes for forcegraph3d', () => {
    const r = valid('forcegraph3d');
    expect(metricValue(r, 'fps').value).toBeNull();
    r.result!.physicsValidation = { ticks: 1, movedNodes: 0 };
    expect(metricValue(r, 'fps').value).toBeNull();
    r.result!.physicsValidation.movedNodes = 10;
    expect(metricValue(r, 'fps').value).toBe(0);
    expect(metricValue(valid('deckgl'), 'physics').value).toBeNull();
  });
  it('retains every applicable library, including missing and unsupported ones', () => {
    const data = { compare: [valid()] } as Results;
    expect(rowsFor(data, 'bar-10k', 'fps')).toHaveLength(8);
    expect(rowsFor(data, 'graph-100k', 'fps')).toHaveLength(5);
    expect(rowsFor(data, 'line-1m-1s', 'fps').filter((r) => r.value !== null)).toHaveLength(1);
  });
});
