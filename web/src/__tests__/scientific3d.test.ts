import { describe, expect, it, vi } from 'vitest';
import { Charturbo } from '../sdk/charturbo';
import { encodePointCloud3D, encodeSurface3D, scientificTooltip, formatScientific3DTick, type PointCloud3DData, type Scientific3DChartOptions } from '../sdk/chart-scientific3d';
import { buildA11yModel, buildDataTable, tableToCSV, buildChartSummary } from '../sdk/chart-a11y';
import { graphBackend } from './graph-backend';

const palette: [number, number, number, number][] = [[0.2, 0.6, 1, 1]];
describe('scientific 3D charts', () => {
  it('keeps tiny and large axis values compact without rounding meaningful values to zero', () => {
    expect(formatScientific3DTick(0, 'en-US')).toBe('0');
    expect(formatScientific3DTick(0.000000123, 'en-US')).toBe('1.23e-7');
    expect(formatScientific3DTick(1e12, 'en-US')).toBe('1e+12');
    expect(formatScientific3DTick(-0.00123, 'en-US')).toBe('-0.00123');
  });
  it('passes fixed axes, data aspect and orthographic framing without changing raw exports', () => {
    const { backend } = graphBackend(); backend.set_chart_3d = vi.fn(() => 2);
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderPointCloud3D([{ name: 'Scan', data: [[0, 0, 0], [100, 10, 1]] }], {
      axes3d: { x: { min: -100, max: 100, name: 'Distance', tickCount: 3 }, z: { visible: false } },
      aspect: 'data', camera: { type: 'orthographic', orthoSize: 150 },
    });
    expect(vi.mocked(backend.set_chart_3d!).mock.lastCall?.[5]).toEqual(new Float64Array([-100, 100, NaN, NaN, NaN, NaN, 1, 1, 1, 1, 3, 5, 0, 1, 150]));
    expect(sdk.exportChartCSV()).toContain('Scan,100,10,1');
    sdk.dispose();
  });
  it('rejects invalid axes, aspect and projection before replacing live data', () => {
    const { backend } = graphBackend(); backend.set_chart_3d = vi.fn(() => 1);
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderPointCloud3D([{ data: [[1, 2, 3]] }]);
    const invalid: Scientific3DChartOptions[] = [
      { axes3d: { x: { min: 1, max: 1 } } }, { axes3d: { y: { min: Infinity } } },
      { axes3d: { z: { tickCount: 1 } } }, { aspect: [1, 0, 1] },
      { camera: { type: 'orthographic', orthoSize: 0 } }, { camera: { target: [1, 2, 3] } },
      { camera: { type: 'invalid' } } as unknown as Scientific3DChartOptions,
    ];
    for (const options of invalid) expect(() => sdk.renderPointCloud3D([{ data: [[9, 9, 9]] }], options)).toThrow(/3D chart/);
    expect(backend.set_chart_3d).toHaveBeenCalledOnce();
    expect(sdk.getNodeDetails(0)?.metadata.attributes?.x).toBe(1);
    sdk.dispose();
  });
  it('retains XYZ gaps and original point ids across series', () => {
    const a = new Float32Array([1, 2, 3, NaN, 0, 1]);
    const e = encodePointCloud3D([{ name: 'A', data: a }, { name: 'B', data: { x: [4], y: [5], z: [6] }, size: 8 }], palette);
    expect(e.xyz).toEqual(new Float32Array([1, 2, 3, NaN, 0, 1, 4, 5, 6]));
    expect(e.offsets).toEqual(new Uint32Array([0, 2, 3]));
    expect(e.styles[3]).toBe(8);
    expect(a).toEqual(new Float32Array([1, 2, 3, NaN, 0, 1]));
    expect(() => encodePointCloud3D([{ data: { x: [0], y: [], z: [1] } }], palette)).toThrow(/length/);
  });
  it('expands row-major Y-up grids including descending spatial steps and holes', () => {
    const e = encodeSurface3D([{ data: { columns: 2, rows: 2, xStart: 10, xStep: -2, zStart: 20, zStep: 3, y: [1, 2, NaN, 4] } }], palette);
    expect(e.xyz).toEqual(new Float32Array([10, 1, 20, 8, 2, 20, 10, NaN, 23, 8, 4, 23]));
    expect(e.shapes).toEqual(new Uint32Array([2, 2]));
    expect(() => encodeSurface3D([{ data: { columns: 2, rows: 2, xStart: 0, xStep: 0, zStart: 0, zStep: 1, y: [1, 2, 3, 4] } }], palette)).toThrow(/step/i);
  });
  it('dispatches typed native data and validates before replacing an existing chart', () => {
    const { backend } = graphBackend();
    backend.set_chart_3d = vi.fn(() => 1);
    const sdk = Charturbo.fromBackend(backend);
    expect(sdk.renderPointCloud3D([{ name: 'Scan', data: [[1, 2, 3]] }])).toEqual({ pointCount: 1, seriesCount: 1 });
    expect(backend.set_chart_3d).toHaveBeenCalledOnce();
    expect(sdk.getNodeDetails(0)?.metadata.attributes).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(() => sdk.renderPointCloud3D([{ data: [[1, 2, 3]], size: -1 }])).toThrow(/size/);
    expect(backend.set_chart_3d).toHaveBeenCalledOnce();
    expect(sdk.getNodeDetails(0)?.metadata.attributes?.z).toBe(3);
    sdk.dispose();
  });
  it('exports raw XYZ with explicit chart identity and navigable finite samples', () => {
    const e = encodePointCloud3D([{ name: 'Scan', data: [[1, 2, 3], null, [4, 5, 6]] }], palette);
    const model = buildA11yModel(e.meta, { title: 'Measured cloud' })!;
    expect(buildChartSummary(model)).toContain('3D point cloud');
    expect(tableToCSV(buildDataTable(model))).toContain('Series,X,Y,Z');
    expect(tableToCSV(buildDataTable(model))).toContain('Scan,4,5,6');
    expect(model.custom?.step?.(null, 'End')).toEqual({ series: 0, index: 2 });
    expect(model.custom?.announce({ series: 0, index: 2 })).toContain('Z 6');
  });
  it('rejects malformed tuples before passing corrupted positions to native code', () => {
    expect(() => encodePointCloud3D([{ data: [[1, 2]] as unknown as PointCloud3DData }], palette)).toThrow(/three/);
  });
  it('keeps interpolated pointer coordinates separate from keyboard vertices', () => {
    const e = encodeSurface3D([{ data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y: [0, 1, 2, 3] } }], palette);
    expect(scientificTooltip(e.meta, 0, null, [0.5, 1.5, 0.5, 0, 0])?.point3d).toEqual({ x: 0.5, y: 1.5, z: 0.5, column: 0, row: 0 });
    expect(scientificTooltip(e.meta, 3, null)?.point3d).toEqual({ x: 1, y: 3, z: 1, column: 1, row: 1 });
    expect(scientificTooltip(e.meta, 3, null, [])?.point3d).toEqual({ x: 1, y: 3, z: 1, column: 1, row: 1 });
  });
  it('honors a uniform surface color and opacity', () => {
    const e = encodeSurface3D([{ color: '#ff0000', opacity: 0.5,
      data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y: [0, 1, 2, 3] } }], palette);
    expect(Array.from(e.colors)).toEqual(Array(4).fill([1, 0, 0, 0.5]).flat());
  });

  function streamingSdk() {
    const { backend } = graphBackend();
    backend.set_chart_3d = vi.fn(() => 0);
    backend.update_chart_3d_series = vi.fn(() => 0);
    return { sdk: Charturbo.fromBackend(backend), backend };
  }
  it('appends cloud XYZ and scalar colors with FIFO, owned inputs and rebased multi-series ids', () => {
    const { sdk, backend } = streamingSdk();
    const data = new Float32Array([1, 2, 3, 4, 5, 6]), values = [0, 1];
    sdk.renderPointCloud3D([{ name: 'A', data, colorBy: { values } }, { name: 'B', data: [[9, 8, 7]] }]);
    data.fill(99); values.fill(99);
    expect(sdk.appendPointCloud3D(0, [[7, 8, 9], null], { maxPoints: 3, colorValues: [2, 3] })).toBe(3);
    expect(sdk.getNodeDetails(0)?.metadata.attributes).toMatchObject({ x: 4, y: 5, z: 6 });
    expect(sdk.getNodeDetails(1)?.metadata.attributes?.z).toBe(9);
    expect(sdk.getNodeDetails(3)?.metadata.label).toContain('B');
    expect(backend.set_chart_3d).toHaveBeenCalledOnce();
    const call = vi.mocked(backend.update_chart_3d_series!).mock.calls[0];
    expect(call[1]).toEqual(new Float32Array([4, 5, 6, 7, 8, 9, NaN, NaN, NaN]));
    const expected = encodePointCloud3D([{ data: [[4, 5, 6], [7, 8, 9], null], colorBy: { values: [1, 2, 3] } }], palette);
    expect(call[2]).toEqual(expected.colors);
    sdk.dispose();
  });
  it('validates streaming atomically, including native rejection and unsupported modes', () => {
    const { sdk, backend } = streamingSdk();
    sdk.renderPointCloud3D([{ data: [[1, 2, 3]], colorBy: { values: [1] } }]);
    expect(() => sdk.appendPointCloud3D(0, [[2, 3, 4]])).toThrow(/color/i);
    expect(() => sdk.appendPointCloud3D(0, [[2, 3, 4]], { maxPoints: -1, colorValues: [2] })).toThrow(/maxPoints/);
    expect(() => sdk.appendPointCloud3D(0.5, [])).toThrow(/series/);
    expect(() => sdk.updateSurface3D(0, { mode: 'replaceY', y: [] })).toThrow(/surface/i);
    expect(backend.update_chart_3d_series).not.toHaveBeenCalled();
    vi.mocked(backend.update_chart_3d_series!).mockImplementation(() => { throw new Error('native rejected'); });
    expect(() => sdk.appendPointCloud3D(0, [[2, 3, 4]], { colorValues: [2] })).toThrow('native rejected');
    expect(sdk.getNodeDetails(0)?.metadata.attributes?.x).toBe(1);
    expect(sdk.getNodeDetails(1)).toBeNull();
    sdk.dispose();
  });
  it('scrolls column-major strips and row-major blocks, including oversized strips and descending steps', () => {
    const { sdk, backend } = streamingSdk();
    sdk.renderSurface3D([{ data: { columns: 2, rows: 2, xStart: 10, xStep: -2, zStart: 20, zStep: 3, y: [1, 2, 3, 4] } }]);
    expect(sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 1, y: [5, 6] })).toEqual({ columns: 2, rows: 2, pointCount: 4 });
    expect(vi.mocked(backend.update_chart_3d_series!).mock.lastCall?.[1]).toEqual(new Float32Array([8, 2, 20, 6, 5, 20, 8, 4, 23, 6, 6, 23]));
    sdk.updateSurface3D(0, { mode: 'appendRows', rows: 3, y: [7, 8, 9, 10, 11, 12] });
    expect(sdk.getNodeDetails(0)?.metadata.attributes).toMatchObject({ x: 8, y: 9, z: 29 });
    sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 2, y: [13, 14, 15, 16], scrollX: false });
    expect(vi.mocked(backend.update_chart_3d_series!).mock.lastCall?.[1]).toEqual(new Float32Array([8, 9, 29, 6, 10, 29, 4, 13, 29, 2, 15, 29, 8, 11, 32, 6, 12, 32, 4, 14, 32, 2, 16, 32]));
    expect(sdk.updateSurface3D(0, { mode: 'appendRows', rows: 1, y: [17, 18, 19, 20], scrollZ: false })).toEqual({ columns: 4, rows: 3, pointCount: 12 });
    sdk.dispose();
  });
  it('replaces heights and color domain, validates before mutation, and exports updated raw coordinates', () => {
    const { sdk, backend } = streamingSdk();
    const y = [1, 2, 3, 4];
    sdk.renderSurface3D([{ name: 'Field', data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y } }]);
    y.fill(99);
    expect(() => sdk.updateSurface3D(0, { mode: 'replaceY', y: [1] })).toThrow(/length/);
    expect(() => sdk.updateSurface3D(0, { mode: 'appendRows', rows: 0.5, y: [1] })).toThrow();
    expect(() => sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 4_000_000, y: [], scrollX: false })).toThrow();
    expect(backend.update_chart_3d_series).not.toHaveBeenCalled();
    sdk.updateSurface3D(0, { mode: 'replaceY', y: [4, NaN, 6, 7], yMin: 0, yMax: 10 });
    expect(sdk.getNodeDetails(3)?.metadata.attributes).toMatchObject({ x: 1, y: 7, z: 1 });
    // Public export is built from the committed metadata, not the original input.
    expect(sdk.exportChartCSV()).toContain('Field,1,7,1');
    expect(() => sdk.updateSurface3D(0, { mode: 'replaceY', y: [4, 5, 6, 7], yMin: 20 })).toThrow(/domain/);
    sdk.dispose();
  });
  it('retains only the tail of oversized cloud / column chunks and supports empty appends', () => {
    const { sdk, backend } = streamingSdk();
    sdk.renderPointCloud3D([{ data: [[1, 2, 3]], color: '#ff0000', opacity: 0.5 }]);
    expect(sdk.appendPointCloud3D(0, [[4, 5, 6], [7, 8, 9], [10, 11, 12]], { maxPoints: 2 })).toBe(2);
    expect(sdk.getNodeDetails(0)?.metadata.attributes?.x).toBe(7);
    expect(sdk.appendPointCloud3D(0, [], { maxPoints: 1 })).toBe(1);
    expect(sdk.getNodeDetails(0)?.metadata.attributes?.x).toBe(10);
    expect(vi.mocked(backend.update_chart_3d_series!).mock.lastCall?.[2]).toEqual(new Float32Array([1, 0, 0, 0.5]));
    sdk.renderSurface3D([{ data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y: [1, 2, 3, 4] } }]);
    sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 3, y: [5, 6, 7, 8, 9, 10] });
    expect(vi.mocked(backend.update_chart_3d_series!).mock.lastCall?.[1]).toEqual(new Float32Array([3, 7, 0, 4, 9, 0, 3, 8, 1, 4, 10, 1]));
    sdk.updateSurface3D(0, { mode: 'appendRows', rows: 0, y: [] });
    expect(sdk.getNodeDetails(3)?.metadata.attributes).toMatchObject({ x: 4, y: 10, z: 1 });
    sdk.dispose();
  });
  it('preserves toggled visibility and commits only after a supported native update succeeds', () => {
    const { sdk, backend } = streamingSdk();
    sdk.renderSurface3D([{ name: 'A', data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y: [1, 2, 3, 4] } }]);
    sdk.setSeriesVisible(0, false);
    sdk.updateSurface3D(0, { mode: 'replaceY', y: [5, 6, 7, 8] });
    expect(sdk.isSeriesVisible(0)).toBe(false);
    backend.update_chart_3d_series = undefined;
    expect(() => sdk.updateSurface3D(0, { mode: 'replaceY', y: [9, 10, 11, 12] })).toThrow(/backend/);
    expect(sdk.exportChartCSV()).toContain('A,1,8,1');
    sdk.dispose();
  });
});
