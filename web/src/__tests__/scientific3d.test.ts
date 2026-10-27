import { describe, expect, it, vi } from 'vitest';
import { Charturbo } from '../sdk/charturbo';
import { encodePointCloud3D, encodeSurface3D, scientificTooltip, type PointCloud3DData } from '../sdk/chart-scientific3d';
import { buildA11yModel, buildDataTable, tableToCSV, buildChartSummary } from '../sdk/chart-a11y';
import { graphBackend } from './graph-backend';

const palette: [number, number, number, number][] = [[0.2, 0.6, 1, 1]];
describe('scientific 3D charts', () => {
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
});
