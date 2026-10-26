// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chartToSvg,
  escapeXml,
  fontAttrs,
  overlayOpsToSvg,
  parseEngineSvg,
  svgDocument,
  type ChartSvgHost,
} from '../sdk/chart-svg';
import { buildPdf, canCopyImage, copyPngToClipboard, deflate, pdfString, rgbaToRgb } from '../sdk/chart-pdf';
import type { OverlayDrawOp } from '../sdk/chart-export';
import { VIZ_THEMES, VizEngineSDK, type WasmVizEngineBackend } from '../sdk/viz-engine-sdk';

vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    showDataTable(): void {}
    hideDataTable(): void {}
    getDataTable(): null {
      return null;
    }
    exportCSV(): string {
      return '';
    }
    summary(): string {
      return '';
    }
  },
}));

const SVG_NS = 'http://www.w3.org/2000/svg';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  return doc;
}

/** What chart/svg.rs writes for a small zoomed line chart (header + clip + layers). */
const ENGINE_LINE =
  '<!--viz:0,12,0,56,16,400,200-->' +
  '<defs><clipPath id="viz-svg-1-plot"><rect x="56" y="16" width="400" height="200"/></clipPath></defs>' +
  '<g data-layer="grid"><path d="M56 216L456 216" fill="none" stroke="rgb(33,43,61)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></g>' +
  '<g data-layer="plot" clip-path="url(#viz-svg-1-plot)">' +
  '<g data-layer="series"><path d="M56 216L156 116L256 66" fill="none" stroke="rgb(255,0,0)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>' +
  '<g data-layer="points"><circle cx="100" cy="100" r="3" fill="rgb(0,0,255)" fill-opacity="0.5"/></g>' +
  '</g>';

describe('SVG helpers', () => {
  it('parses the engine header', () => {
    const e = parseEngineSvg(ENGINE_LINE)!;
    expect(e).toMatchObject({ support: 0, marks: 12, truncated: false, plot: [56, 16, 400, 200] });
    expect(e.body.startsWith('<defs>')).toBe(true);
    expect(parseEngineSvg('<g/>')).toBeNull();
    expect(parseEngineSvg('<!--viz:1,5,1,1,2,3,4-->')).toMatchObject({ support: 1, truncated: true, plot: [1, 2, 3, 4] });
  });

  it('escapes text and splits fonts', () => {
    expect(escapeXml(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;');
    expect(fontAttrs('normal 400 12px Inter, "Segoe UI", sans-serif')).toBe(
      ' font-family="Inter, &quot;Segoe UI&quot;, sans-serif" font-size="12px"'
    );
    expect(fontAttrs('italic 600 14px serif')).toBe(' font-family="serif" font-size="14px" font-weight="600" font-style="italic"');
  });

  it('turns overlay ops into rects and positioned / rotated texts', () => {
    const ops: OverlayDrawOp[] = [
      { kind: 'rect', box: { left: 10, top: 5, width: 10, height: 10 }, color: 'rgb(1, 2, 3)', radius: 2, opacity: 1 },
      {
        kind: 'text',
        text: 'Revenue <USD>',
        box: { left: 30, top: 0, width: 80, height: 20 },
        font: 'normal 600 13px sans-serif',
        color: 'rgb(200, 200, 200)',
        opacity: 0.5,
        angle: 0,
        lineThrough: true,
        maxWidth: Infinity,
      },
      {
        kind: 'text',
        text: 'Value',
        box: { left: 0, top: 100, width: 14, height: 40 },
        font: 'normal 400 12px sans-serif',
        color: '#fff',
        opacity: 1,
        angle: -Math.PI / 2,
        lineThrough: false,
        maxWidth: Infinity,
      },
    ];
    const doc = parse(`<svg xmlns="${SVG_NS}">${overlayOpsToSvg(ops)}</svg>`);
    const rect = doc.getElementsByTagName('rect')[0];
    expect([rect.getAttribute('x'), rect.getAttribute('width'), rect.getAttribute('rx'), rect.getAttribute('fill')]).toEqual([
      '10',
      '10',
      '2',
      'rgb(1, 2, 3)',
    ]);
    const [title, axis] = Array.from(doc.getElementsByTagName('text'));
    expect(title.textContent).toBe('Revenue <USD>');
    expect(title.getAttribute('x')).toBe('30');
    expect(title.getAttribute('y')).toBe('10'); // vertical middle of the box
    expect(title.getAttribute('text-anchor')).toBe('start');
    expect(title.getAttribute('font-weight')).toBe('600');
    expect(title.getAttribute('opacity')).toBe('0.5');
    expect(title.getAttribute('text-decoration')).toBe('line-through');
    expect(axis.getAttribute('text-anchor')).toBe('middle');
    expect(axis.getAttribute('transform')).toBe('rotate(-90 7 120)');
    // Ellipsis clipping with a measure function
    const clipped = overlayOpsToSvg(
      [{ ...(ops[1] as Extract<OverlayDrawOp, { kind: 'text' }>), text: 'abcdefghij', maxWidth: 5 }],
      (s) => s.length
    );
    expect(clipped).toContain('>abcd…</text>');
  });

  it('assembles a valid document with background, raster image, marks and overlay', () => {
    const svg = svgDocument({
      width: 480,
      height: 300,
      background: 'rgb(9, 11, 20)',
      image: { href: 'data:image/png;base64,AAAA', x: 56, y: 16, width: 400, height: 200 },
      marks: parseEngineSvg(ENGINE_LINE)!.body,
      overlay: '<text x="1" y="2">T</text>',
    });
    const doc = parse(svg);
    const root = doc.documentElement;
    expect(root.namespaceURI).toBe(SVG_NS);
    expect([root.getAttribute('width'), root.getAttribute('height'), root.getAttribute('viewBox')]).toEqual(['480', '300', '0 0 480 300']);
    const bg = root.querySelector('[data-layer="background"]')!;
    expect(bg.getAttribute('fill')).toBe('rgb(9, 11, 20)');
    expect(root.querySelector('image')!.getAttribute('href')).toBe('data:image/png;base64,AAAA');
    const plot = root.querySelector('[data-layer="plot"]')!;
    expect(plot.getAttribute('clip-path')).toBe('url(#viz-svg-1-plot)');
    expect(root.querySelector('clipPath#viz-svg-1-plot rect')!.getAttribute('width')).toBe('400');
    const line = root.querySelector('[data-layer="series"] path')!;
    expect(line.getAttribute('d')).toBe('M56 216L156 116L256 66');
    expect(line.getAttribute('stroke')).toBe('rgb(255,0,0)');
    expect(root.querySelector('[data-layer="points"] circle')!.getAttribute('fill-opacity')).toBe('0.5');
    expect(root.querySelector('[data-layer="overlay"] text')!.textContent).toBe('T');
    // Background order: first child
    expect(root.firstElementChild).toBe(bg);
  });
});

describe('chartToSvg', () => {
  let canvas: HTMLCanvasElement;
  let overlay: HTMLDivElement;
  const rects = new Map<Element, DOMRect>();
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    Object.defineProperty(canvas, 'clientWidth', { value: 480 });
    document.body.appendChild(canvas);
    overlay = document.createElement('div');
    overlay.innerHTML = '<div class="title" style="font: 600 14px sans-serif; color: rgb(10, 20, 30)">Sales</div><span class="tick">2024</span>';
    document.body.appendChild(overlay);
    rects.set(canvas, rect(100, 50, 480, 300));
    rects.set(overlay, rect(100, 50, 480, 300));
    rects.set(overlay.querySelector('.title')!, rect(300, 54, 60, 18));
    rects.set(overlay.querySelector('.tick')!, rect(150, 330, 30, 12));
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rects.get(this) ?? rect(0, 0, 0, 0);
    });
    // jsdom has no layout for text ranges: fall back to the element box
    (Range.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => rect(0, 0, 0, 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    canvas.remove();
    overlay.remove();
  });

  const host = (raw: string, kind = 'line', warn = vi.fn()): ChartSvgHost & { warn: typeof warn; renders: number } => {
    const h = {
      canvas,
      overlay,
      theme: VIZ_THEMES.dark,
      backend: { chart_export_svg: vi.fn(() => raw) },
      renders: 0,
      render: () => void h.renders++,
      kind,
      warn,
    };
    return h;
  };

  it('vector chart: engine marks + overlay text at canvas-relative positions', () => {
    const h = host(ENGINE_LINE);
    const doc = parse(chartToSvg(h, { maxMarks: 5000 }));
    expect(h.renders).toBeGreaterThan(0); // staged the current view first
    expect(h.backend.chart_export_svg).toHaveBeenCalledWith(5000, expect.stringMatching(/^viz-svg-\d+$/));
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe('480');
    expect(root.getAttribute('height')).toBe('300');
    expect(root.querySelector('[data-layer="background"]')!.getAttribute('fill')).toMatch(/^rgba\(/);
    expect(root.querySelectorAll('[data-layer="series"] path').length).toBe(1);
    expect(root.querySelector('image')).toBeNull();
    const texts = Array.from(root.querySelectorAll('[data-layer="overlay"] text'));
    expect(texts.map((t) => t.textContent)).toEqual(['Sales', '2024']);
    // Title box 300 - 100 = 200 left, 54 - 50 + 9 = 13 middle
    expect([texts[0].getAttribute('x'), texts[0].getAttribute('y')]).toEqual(['200', '13']);
    expect(texts[0].getAttribute('font-weight')).toBe('600');
    expect(texts[0].getAttribute('fill')).toBe('rgb(10, 20, 30)');
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('transparent / custom backgrounds and no overlay', () => {
    const t = parse(chartToSvg(host(ENGINE_LINE), { background: 'transparent', overlay: false })).documentElement;
    expect(t.querySelector('[data-layer="background"]')).toBeNull();
    expect(t.querySelector('[data-layer="overlay"]')).toBeNull();
    const c = parse(chartToSvg(host(ENGINE_LINE), { background: 'white' })).documentElement;
    expect(c.querySelector('[data-layer="background"]')!.getAttribute('fill')).toBe('white');
  });

  it('warns on truncation and falls back to an embedded canvas for raster kinds', () => {
    const warn = vi.fn();
    chartToSvg(host('<!--viz:0,100,1,0,0,10,10--><g/>', 'scatter', warn));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/thinned/));
    // jsdom has no 2D canvas: the raster part is skipped but text is still vector
    const warn2 = vi.fn();
    const doc = parse(chartToSvg(host('<!--viz:2,0,0,0,0,0,0-->', 'line', warn2)));
    expect(warn2).toHaveBeenCalledWith(expect.stringMatching(/PNG <image>/));
    expect(doc.querySelectorAll('[data-layer="overlay"] text').length).toBe(2);
    // With a 2D context the canvas is embedded (heatmap: just the plot rectangle)
    const draws: number[][] = [];
    const ctx = { drawImage: (...a: number[]) => draws.push(a.slice(1)) };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx as never;
    } as typeof orig;
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,QUJD';
    const heat = parse(chartToSvg(host('<!--viz:1,0,0,56,16,400,200--><g data-layer="grid"/>', 'heatmap'))).documentElement;
    HTMLCanvasElement.prototype.getContext = orig;
    const img = heat.querySelector('image')!;
    expect([img.getAttribute('x'), img.getAttribute('y'), img.getAttribute('width'), img.getAttribute('height')]).toEqual(['56', '16', '400', '200']);
    expect(img.getAttribute('href')).toBe('data:image/png;base64,QUJD');
    // Source rect in device px (2x canvas)
    expect(draws[0].slice(0, 4)).toEqual([112, 32, 800, 400]);
  });

  it('SDK exportChartSVG / downloadChartSVG', () => {
    const backend = {
      set_line_chart: () => 3,
      sync_and_render: () => {},
      clear_scene_objects: () => {},
      set_rigid_physics: () => {},
      set_graph_visible: () => {},
      set_scene_helpers: () => {},
      clear_selection: () => {},
      chart_export_svg: () => ENGINE_LINE,
    } as unknown as WasmVizEngineBackend;
    const sdk = VizEngineSDK.fromBackend(backend);
    sdk.enableNodeInteractions(canvas, { builtInTooltip: false });
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }], { title: 'Hello' });
    const doc = parse(sdk.exportChartSVG());
    expect(doc.querySelector('[data-layer="series"] path')).not.toBeNull();
    const created: Blob[] = [];
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => (created.push(b), 'blob:x'), revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    sdk.downloadChartSVG('out.svg');
    expect(click).toHaveBeenCalled();
    expect(created[0].type).toBe('image/svg+xml');
    vi.unstubAllGlobals();
  });
});

describe('PDF writer', () => {
  const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

  it('writes a single-page PDF with a correct xref table', () => {
    const rgb = rgbaToRgb(new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]));
    expect(Array.from(rgb)).toEqual([255, 0, 0, 255, 255, 255]); // transparent -> white
    const pdf = buildPdf({ widthPt: 360, heightPt: 225, image: { width: 2, height: 1, data: rgb, deflated: false }, title: 'Sales (Q1)' });
    const s = text(pdf);
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/MediaBox [0 0 360 225]');
    expect(s).toContain('/Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 6');
    expect(s).not.toContain('/FlateDecode');
    expect(s).toContain('q 360 0 0 225 0 0 cm /Im0 Do Q');
    expect(s).toContain('/Title (Sales \\(Q1\\))');
    // Every xref offset points at its object; startxref at the table
    const startxref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBe(6);
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(pdfString('a(b)\\ü')).toBe('(a\\(b\\)\\\\)');
  });

  it('deflates the image stream (zlib, round trip)', async () => {
    const data = new Uint8Array(3000).map((_, i) => i % 7);
    const packed = await deflate(data);
    expect(packed).not.toBeNull();
    expect(packed!.length).toBeLessThan(data.length);
    expect(packed![0]).toBe(0x78); // zlib header (FlateDecode)
    const ds = new DecompressionStream('deflate');
    const w = ds.writable.getWriter();
    void w.write(packed! as Uint8Array<ArrayBuffer>);
    void w.close();
    const back = new Uint8Array(await new Response(ds.readable).arrayBuffer());
    expect(back).toEqual(data);
    const pdf = text(buildPdf({ widthPt: 10, heightPt: 10, image: { width: 1000, height: 1, data: packed!, deflated: true } }));
    expect(pdf).toContain('/Filter /FlateDecode');
  });
});

describe('clipboard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('feature-detects ClipboardItem and writes a PNG item', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    expect(canCopyImage()).toBe(false);
    expect(await copyPngToClipboard(new Blob())).toBe(false);
    const written: unknown[] = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, unknown>) {}
      }
    );
    vi.stubGlobal('navigator', { clipboard: { write: async (items: unknown[]) => void written.push(...items) } });
    expect(canCopyImage()).toBe(true);
    expect(await copyPngToClipboard(new Blob(['x'], { type: 'image/png' }))).toBe(true);
    expect(Object.keys((written[0] as { items: object }).items)).toEqual(['image/png']);
    vi.stubGlobal('navigator', { clipboard: { write: async () => Promise.reject(new Error('denied')) } });
    expect(await copyPngToClipboard(new Blob())).toBe(false);
  });
});
