// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { ChartWatermarkLayer, resolveWatermark, watermarkSvg, watermarkTiles } from '../sdk/chart-watermark';
import { svgDocument } from '../sdk/chart-svg';
import { CHARTURBO_THEMES, Charturbo } from '../sdk/charturbo';
import { graphBackend } from './graph-backend';

const dark = CHARTURBO_THEMES.dark;

afterEach(() => document.body.replaceChildren());

describe('resolveWatermark', () => {
  it('fills defaults and validates', () => {
    const w = resolveWatermark({ text: 'CONFIDENTIAL' });
    expect(w).toMatchObject({ text: 'CONFIDENTIAL', opacity: 0.15, rotate: 30, fontSize: 14, gap: [80, 60], repeat: true, export: true });
    expect(resolveWatermark({ image: 'logo.png', gap: 10 }).gap).toEqual([10, 10]);
    expect(() => resolveWatermark({})).toThrow(/text or image/);
    expect(() => resolveWatermark({ text: 'x', opacity: 2 })).toThrow(/opacity/);
    expect(() => resolveWatermark({ text: 'x', fontSize: 0 })).toThrow(/fontSize/);
    expect(() => resolveWatermark({ text: 'x', gap: [1] as never })).toThrow(/gap/);
    expect(() => resolveWatermark({ text: 'x', color: 'nope' })).toThrow(/color/);
    expect(() => resolveWatermark({ text: 'x', rotate: NaN })).toThrow(/rotate/);
  });
});

describe('watermarkTiles', () => {
  it('one centered tile without repeat', () => {
    expect(watermarkTiles(400, 200, 100, 20, [80, 60], false)).toEqual([[200, 100]]);
  });

  it('staggered rows of cells cover the whole area (beyond the edges for rotation)', () => {
    const tiles = watermarkTiles(400, 200, 100, 20, [80, 60], true);
    // cell 180 x 80: every point of the area lies within a cell of some tile center
    for (const [px, py] of [
      [0, 0],
      [399, 199],
      [200, 100],
      [10, 190],
    ]) {
      expect(tiles.some(([x, y]) => Math.abs(x - px) <= 90 && Math.abs(y - py) <= 40)).toBe(true);
    }
    const rows = [...new Set(tiles.map((t) => t[1]))].sort((a, b) => a - b);
    expect(rows[1] - rows[0]).toBe(80);
    const firstRow = tiles.filter((t) => t[1] === rows[0]).map((t) => t[0]);
    const secondRow = tiles.filter((t) => t[1] === rows[1]).map((t) => t[0]);
    // Odd rows are shifted by half a cell
    expect(((secondRow[0] - firstRow[0]) % 180 + 180) % 180).toBe(90);
  });
});

describe('watermark painting', () => {
  it('paints rotated text tiles with the opacity (2D context calls)', () => {
    const w = resolveWatermark({ text: 'DRAFT', repeat: false, color: '#ff0000', opacity: 0.4, rotate: 90 });
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      translate: (x: number, y: number) => calls.push(`translate ${x} ${y}`),
      rotate: (a: number) => calls.push(`rotate ${a.toFixed(4)}`),
      scale: (x: number) => calls.push(`scale ${x}`),
      fillText: (t: string, x: number, y: number) => calls.push(`text ${t} ${x} ${y}`),
      measureText: (t: string) => ({ width: t.length * 8 }),
      set globalAlpha(v: number) {
        calls.push(`alpha ${v}`);
      },
      set fillStyle(v: string) {
        calls.push(`fill ${v}`);
      },
      set font(v: string) {
        calls.push(`font ${v}`);
      },
      textAlign: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D;
    const layer = new ChartWatermarkLayer(() => null, () => dark);
    layer.set(w);
    layer.paint(ctx, 300, 100, 2);
    expect(calls).toContain('scale 2');
    expect(calls).toContain('alpha 0.4');
    expect(calls).toContain('fill rgb(255, 0, 0)');
    expect(calls).toContain('translate 150 50');
    // Positive = anticlockwise (canvas rotates clockwise)
    expect(calls).toContain(`rotate ${(-Math.PI / 2).toFixed(4)}`);
    expect(calls).toContain('text DRAFT 0 0');
  });

  it('SVG tiles: text with font, color, opacity and rotation; images as <image>', () => {
    const w = resolveWatermark({ text: 'A&B', repeat: false, rotate: 30, color: '#00ff00', opacity: 0.5 });
    const svg = watermarkSvg(w, dark, 200, 100, () => 30);
    expect(svg).toContain('<g data-layer="watermark" opacity="0.5" aria-hidden="true">');
    expect(svg).toContain('A&amp;B');
    expect(svg).toContain('fill="rgb(0, 255, 0)"');
    expect(svg).toContain('transform="translate(100 50) rotate(-30)"');
    const img = watermarkSvg(resolveWatermark({ image: 'https://x/logo.png?a=1&b=2', imageWidth: 40, imageHeight: 20, repeat: false }), dark, 200, 100, () => 0);
    expect(img).toContain('<image');
    expect(img).toContain('href="https://x/logo.png?a=1&amp;b=2"');
    expect(img).toContain('x="-20" y="-10" width="40" height="20"');
    expect(watermarkSvg(resolveWatermark({ text: 'x', export: false }), dark, 200, 100, () => 0)).toBe('');
  });

  it('svgDocument puts the watermark between the marks and the overlay', () => {
    const doc = svgDocument({ width: 10, height: 10, background: null, marks: '<g id="m"/>', overlay: '<text/>', watermark: '<g data-layer="watermark"/>' });
    expect(doc.indexOf('id="m"')).toBeLessThan(doc.indexOf('data-layer="watermark"'));
    expect(doc.indexOf('data-layer="watermark"')).toBeLessThan(doc.indexOf('data-layer="overlay"'));
  });
});

describe('ChartWatermarkLayer DOM', () => {
  it('an aria-hidden, click-through layer over the canvas, under the chart overlay', () => {
    const box = document.createElement('div');
    const canvas = document.createElement('canvas');
    box.appendChild(canvas);
    document.body.appendChild(box);
    const layer = new ChartWatermarkLayer(() => canvas, () => dark);
    layer.set(resolveWatermark({ text: 'x' }));
    layer.layout();
    const el = box.querySelector<HTMLElement>('.charturbo-sdk-watermark')!;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.style.zIndex).toBe('4');
    expect(el.dataset.charturboExport).toBe('false');
    layer.set(null);
    expect(box.querySelector('.charturbo-sdk-watermark')).toBeNull();
  });
});

describe('Charturbo setWatermark', () => {
  it('sets, replaces, validates before replacing, clears; export hooks paint it', () => {
    const box = document.createElement('div');
    const canvas = document.createElement('canvas');
    box.appendChild(canvas);
    document.body.appendChild(box);
    const sdk = Charturbo.fromBackend(graphBackend().backend);
    sdk.enableNodeInteractions(canvas);
    sdk.setWatermark({ text: 'one' });
    expect(sdk.getWatermark()?.text).toBe('one');
    expect(() => sdk.setWatermark({ text: 'two', opacity: -1 })).toThrow(/opacity/);
    expect(sdk.getWatermark()?.text).toBe('one');
    const host = (sdk as unknown as { svgHost(): { watermark?: (w: number, h: number) => string } }).svgHost();
    expect(host.watermark?.(100, 50)).toContain('one');
    sdk.setWatermark(null);
    expect(sdk.getWatermark()).toBeNull();
    expect(box.querySelector('.charturbo-sdk-watermark')).toBeNull();
    sdk.setWatermark({ text: 'x' });
    sdk.dispose();
    expect(box.querySelector('.charturbo-sdk-watermark')).toBeNull();
  });
});
