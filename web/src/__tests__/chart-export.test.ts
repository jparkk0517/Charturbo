import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  borderRadiusPx,
  captureChartCanvas,
  chartToBlob,
  collectOverlayOps,
  exportSize,
  fitText,
  formatFromFilename,
  isBlankCapture,
  paintOverlay,
  parseCssColor,
  parseTransform,
  resolveBackground,
  textAnchor,
  unmixAlpha,
  type Box,
  type ChartExportHost,
  type OverlayEnv,
  type OverlayStyle,
  type PaintContext,
} from '../sdk/chart-export';
import { VIZ_THEMES, VizEngineSDK, type WasmVizEngineBackend } from '../sdk/viz-engine-sdk';

const DEG = Math.PI / 180;

describe('parseTransform', () => {
  it('reads authored translate / rotate functions', () => {
    const t = parseTransform('translate(-50%, -50%) rotate(-90deg)');
    expect(t.angle).toBeCloseTo(-90 * DEG);
    expect(t.tx).toEqual({ px: 0, pct: -0.5 });
    expect(t.ty).toEqual({ px: 0, pct: -0.5 });
    const u = parseTransform('translate(-100%, -50%)');
    expect(u.angle).toBe(0);
    expect(u.tx.pct).toBe(-1);
    expect(parseTransform('translate(-50%, 0)').ty).toEqual({ px: 0, pct: 0 });
    expect(parseTransform('translateX(4px) translateY(-25%)')).toMatchObject({ tx: { px: 4 }, ty: { pct: -0.25 } });
  });

  it('reads the computed matrix form and other angle units', () => {
    // rotate(-90deg) computed: matrix(cos, sin, -sin, cos, tx, ty)
    const m = parseTransform('matrix(6.12323e-17, -1, 1, 6.12323e-17, -20, 3)');
    expect(m.angle).toBeCloseTo(-90 * DEG);
    expect(m.tx.px).toBe(-20);
    expect(m.ty.px).toBe(3);
    expect(parseTransform('rotate(0.25turn)').angle).toBeCloseTo(Math.PI / 2);
    expect(parseTransform('rotate(-1.5rad)').angle).toBeCloseTo(-1.5);
    expect(parseTransform('none')).toEqual({ angle: 0, tx: { px: 0, pct: 0 }, ty: { px: 0, pct: 0 } });
    expect(parseTransform(undefined).angle).toBe(0);
  });
});

describe('colors / background', () => {
  it('parses hex and rgb() colors', () => {
    expect(parseCssColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseCssColor('#00000080')![3]).toBeCloseTo(128 / 255);
    expect(parseCssColor('rgb(255, 0, 51)')).toEqual([1, 0, 0.2, 1]);
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
    expect(parseCssColor('rgb(0 255 0 / 25%)')).toEqual([0, 1, 0, 0.25]);
    expect(parseCssColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(parseCssColor('not-a-color')).toBeNull();
  });

  it('resolves theme / transparent / css backgrounds', () => {
    const theme = VIZ_THEMES.light;
    expect(resolveBackground(undefined, theme)).toEqual({ mode: 'theme', color: theme.surface });
    expect(resolveBackground('theme', theme).mode).toBe('theme');
    expect(resolveBackground('transparent', theme)).toEqual({ mode: 'transparent', under: null });
    expect(resolveBackground('#ffffff', theme)).toEqual({ mode: 'color', color: [1, 1, 1, 1] });
    // Translucent colors become an alpha export with the color painted underneath
    expect(resolveBackground('rgba(255, 0, 0, 0.5)', theme)).toEqual({ mode: 'transparent', under: 'rgba(255, 0, 0, 0.5)' });
    // Named colors go through the (browser) normalizer; unknown ones fall back to the theme
    expect(resolveBackground('white', theme, () => '#ffffff')).toEqual({ mode: 'color', color: [1, 1, 1, 1] });
    expect(resolveBackground('bogus', theme).mode).toBe('theme');
  });
});

describe('pixel helpers', () => {
  it('sizes the export and caps it at the max texture dimension', () => {
    expect(exportSize(800, 400, 2)).toEqual({ width: 1600, height: 800, ratio: 2 });
    const big = exportSize(3000, 1000, 4, 8192);
    expect(big.width).toBe(8192);
    expect(big.height).toBe(Math.round(8192 / 3));
    expect(exportSize(10, 10, NaN).ratio).toBe(1);
  });

  it('recovers exact alpha from black / white renders', () => {
    // Pixel 0: opaque red; 1: background only; 2: 50% blue
    const black = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 128, 255]);
    const white = new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 255, 127, 127, 255, 255]);
    const out = unmixAlpha(black, white, new Uint8ClampedArray(12));
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...out.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(out[11]).toBe(128);
    expect(out[10]).toBe(255);
    expect(out[8]).toBe(0);
  });

  it('detects a blank (fully transparent) read back', () => {
    expect(isBlankCapture(() => 0, 100, 50)).toBe(true);
    expect(isBlankCapture((x, y) => (x > 50 && y > 25 ? 255 : 0), 100, 50)).toBe(false);
  });

  it('maps file extensions to formats', () => {
    expect(formatFromFilename('a.PNG')).toBe('png');
    expect(formatFromFilename('a.jpg')).toBe('jpeg');
    expect(formatFromFilename('a.webp')).toBe('webp');
    expect(formatFromFilename('chart')).toBe('png');
  });
});

describe('text layout', () => {
  it('anchors upright text left / middle and rotated text at its center', () => {
    const box: Box = { left: 10, top: 20, width: 40, height: 14 };
    expect(textAnchor(box, 0)).toEqual({ x: 10, y: 27, align: 'left' });
    // A rotate(-90deg) title's bounds are tall and narrow; it rotates about the center
    const tall: Box = { left: 0, top: 100, width: 14, height: 80 };
    expect(textAnchor(tall, -Math.PI / 2)).toEqual({ x: 7, y: 140, align: 'center' });
  });

  it('ellipsizes to a width', () => {
    const measure = (s: string) => s.length * 10;
    expect(fitText('hello', 100, measure)).toBe('hello');
    expect(fitText('hello world', 60, measure)).toBe('hello…');
    expect(fitText('hello', Infinity, measure)).toBe('hello');
    expect(fitText('hello', 5, measure)).toBe('');
  });

  it('resolves border radius', () => {
    expect(borderRadiusPx('50%', 8, 8)).toBe(4);
    expect(borderRadiusPx('2px', 12, 3)).toBe(1.5);
    expect(borderRadiusPx('0px', 10, 10)).toBe(0);
    expect(borderRadiusPx(undefined, 10, 10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Overlay DOM walk over a fake tree with a fixed layout
// ---------------------------------------------------------------------------

class FakeNode {
  nodeType: number;
  textContent: string | null;
  childNodes: FakeNode[] = [];
  attrs: Record<string, string> = {};
  constructor(
    type: 'el' | 'text',
    text = '',
    public styleOverrides: Partial<OverlayStyle> = {},
    public box: Box = { left: 0, top: 0, width: 0, height: 0 }
  ) {
    this.nodeType = type === 'el' ? 1 : 3;
    this.textContent = type === 'text' ? text : null;
  }
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null;
  }
  add(...c: FakeNode[]): this {
    this.childNodes.push(...c);
    return this;
  }
}

const baseStyle: OverlayStyle = {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  color: 'rgb(195, 194, 183)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  fontStyle: 'normal',
  fontWeight: '400',
  fontSize: '12px',
  fontFamily: 'sans-serif',
  transform: 'none',
  textDecorationLine: 'none',
  overflow: 'visible',
  textOverflow: 'clip',
  clip: 'auto',
};

const el = (style: Partial<OverlayStyle>, box: Box, ...children: FakeNode[]) => new FakeNode('el', '', style, box).add(...children);
const text = (t: string, box?: Box) => {
  const n = new FakeNode('text', t);
  if (box) n.box = box;
  return n;
};

const fakeEnv: OverlayEnv = {
  style: (e) => ({ ...baseStyle, ...(e as unknown as FakeNode).styleOverrides }),
  rect: (e) => (e as unknown as FakeNode).box,
  textRect: (n, e) => {
    const b = (n as unknown as FakeNode).box;
    return b.width || b.height ? b : (e as unknown as FakeNode).box;
  },
};

/** Canvas at viewport (100, 50); overlay mirrors the SDK's title / legend / ticks / axis titles. */
function sampleOverlay(): FakeNode {
  const B = (l: number, t: number, w: number, h: number): Box => ({ left: 100 + l, top: 50 + t, width: w, height: h });
  const title = el(
    { fontSize: '14px', fontWeight: '600', color: 'rgb(240, 239, 236)', overflow: 'hidden', textOverflow: 'ellipsis' },
    B(56, 10, 200, 18),
    text('Throughput', B(56, 10, 70, 18))
  );
  const legendItem = (name: string, x: number, on: boolean) =>
    el(
      { display: 'inline-flex', opacity: on ? '1' : '0.45', textDecorationLine: on ? 'none' : 'line-through' },
      B(x, 36, 80, 16),
      el({ backgroundColor: 'rgb(57, 135, 229)', borderRadius: '2px' }, B(x, 42, 12, 3)),
      el({}, B(x + 18, 36, 60, 16), text(name))
    );
  const legend = el({ display: 'flex' }, B(56, 36, 300, 16), legendItem('RPS', 56, true), legendItem('P99', 150, false));
  const tick = el({ fontSize: '11px', color: 'rgb(139, 138, 132)', transform: 'matrix(1, 0, 0, 1, -10, 0)' }, B(80, 370, 20, 14), text('100'));
  const yTitle = el({ transform: 'matrix(0, -1, 1, 0, -7, -40)' }, B(4, 150, 14, 80), text('requests / s'));
  const hidden = el({ display: 'none' }, B(0, 0, 50, 10), text('gone'));
  const srOnly = el({ clip: 'rect(0px, 0px, 0px, 0px)' }, B(0, 0, 1, 1), text('screen reader only'));
  const skipped = el({}, B(0, 0, 40, 10), text('skip me'));
  skipped.attrs['data-viz-export'] = 'false';
  return el({ color: 'rgb(195, 194, 183)' }, B(0, 0, 800, 400), title, legend, tick, yTitle, hidden, srOnly, skipped);
}

describe('collectOverlayOps', () => {
  it('walks visible overlay elements into canvas-relative draw ops', () => {
    const ops = collectOverlayOps(sampleOverlay() as unknown as Element, { left: 100, top: 50 }, fakeEnv);
    const texts = ops.filter((o) => o.kind === 'text');
    expect(texts.map((o) => o.text)).toEqual(['Throughput', 'RPS', 'P99', '100', 'requests / s']);

    const title = texts[0];
    expect(title.box).toEqual({ left: 56, top: 10, width: 70, height: 18 });
    expect(title.font).toBe('normal 600 14px sans-serif');
    expect(title.color).toBe('rgb(240, 239, 236)');
    // Ellipsis clip runs to the title box's right edge
    expect(title.maxWidth).toBe(200);

    // Hidden legend entry: faded + struck through (inherited from the item)
    const p99 = texts[2];
    expect(p99.opacity).toBeCloseTo(0.45);
    expect(p99.lineThrough).toBe(true);
    expect(texts[1].lineThrough).toBe(false);
    expect(texts[1].maxWidth).toBe(Infinity);

    expect(texts[3].angle).toBe(0);
    expect(texts[4].angle).toBeCloseTo(-Math.PI / 2);

    const rects = ops.filter((o) => o.kind === 'rect');
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ box: { left: 56, top: 42, width: 12, height: 3 }, color: 'rgb(57, 135, 229)', radius: 1.5, opacity: 1 });
    expect(rects[1].opacity).toBeCloseTo(0.45);
  });
});

// ---------------------------------------------------------------------------
// Painting into a recording 2D context
// ---------------------------------------------------------------------------

type Call = [string, ...unknown[]];

function recorder(): PaintContext & { calls: Call[] } {
  const calls: Call[] = [];
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
  };
  const ctx = {
    calls,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: rec('save'),
    restore: rec('restore'),
    scale: rec('scale'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    beginPath: rec('beginPath'),
    rect: rec('rect'),
    fill: () => calls.push(['fill', ctx.fillStyle, ctx.globalAlpha]),
    fillRect: rec('fillRect'),
    fillText: (t: string, x: number, y: number) => calls.push(['fillText', t, x, y, ctx.font, ctx.fillStyle, ctx.textAlign, ctx.globalAlpha]),
    measureText: (s: string) => ({ width: s.length * 6 }) as TextMetrics,
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arcTo: rec('arcTo'),
    closePath: rec('closePath'),
    stroke: rec('stroke'),
    clip: rec('clip'),
  };
  return ctx as unknown as PaintContext & { calls: Call[] };
}

describe('paintOverlay', () => {
  it('scales, clips, and draws text / swatches with their styles', () => {
    const ops = collectOverlayOps(sampleOverlay() as unknown as Element, { left: 100, top: 50 }, fakeEnv);
    const ctx = recorder();
    paintOverlay(ctx, ops, 2, 800, 400);
    const c = ctx.calls;
    expect(c[0]).toEqual(['save']);
    expect(c[1]).toEqual(['scale', 2, 2]);
    expect(c).toContainEqual(['rect', 0, 0, 800, 400]);
    expect(c).toContainEqual(['clip']);

    const texts = c.filter((x) => x[0] === 'fillText');
    expect(texts.map((x) => x[1])).toEqual(['Throughput', 'RPS', 'P99', '100', 'requests / s']);
    expect(texts[0]).toEqual(['fillText', 'Throughput', 0, 0, 'normal 600 14px sans-serif', 'rgb(240, 239, 236)', 'left', 1]);
    expect(texts[2][7]).toBeCloseTo(0.45);
    // Upright title translated to its left / middle anchor; y title rotated about its center
    expect(c).toContainEqual(['translate', 56, 19]);
    expect(c).toContainEqual(['translate', 11, 190]);
    const rot = c.find((x) => x[0] === 'rotate');
    expect(rot?.[1]).toBeCloseTo(-Math.PI / 2);
    expect(texts[4][6]).toBe('center');
    // Strike-through only on the hidden series
    expect(c.filter((x) => x[0] === 'stroke')).toHaveLength(1);
    // Swatch: rounded rect path filled with the series color
    expect(c).toContainEqual(['fill', 'rgb(57, 135, 229)', 1]);
    expect(c.filter((x) => x[0] === 'arcTo').length).toBeGreaterThan(0);
  });

  it('ellipsizes clipped text', () => {
    const ctx = recorder();
    paintOverlay(
      ctx,
      [
        {
          kind: 'text',
          text: 'A very long chart title',
          box: { left: 0, top: 0, width: 138, height: 18 },
          font: '14px sans-serif',
          color: '#fff',
          opacity: 1,
          angle: 0,
          lineThrough: false,
          maxWidth: 60,
        },
      ],
      1,
      800,
      400
    );
    expect(ctx.calls.find((x) => x[0] === 'fillText')?.[1]).toBe('A very lo…');
  });
});

// ---------------------------------------------------------------------------
// Capture flow with fake canvases (resize / clear color / restore order, blank retry)
// ---------------------------------------------------------------------------

interface FakeCanvas {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  clientLeft: number;
  clientTop: number;
  getBoundingClientRect(): Box;
  getContext(): unknown;
  toBlob(cb: (b: Blob | null) => void, type: string, q?: number): void;
  ctx: ReturnType<typeof fake2d>;
}

function fake2d(log: string[], blank: () => boolean) {
  return {
    ...recorder(),
    drawImage: (src: { width: number; height: number }, _x: number, _y: number, w: number, h: number) =>
      log.push(`drawImage ${src.width}x${src.height} -> ${w}x${h}`),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(blank() ? 0 : 255),
    }),
    putImageData: () => log.push('putImageData'),
    globalCompositeOperation: 'source-over',
  };
}

function setup(opts: { blankFrames?: number; clearHook?: boolean } = {}) {
  const log: string[] = [];
  let blankFrames = opts.blankFrames ?? 0;
  let rendering = false;
  const makeCanvas = (w: number, h: number): FakeCanvas => {
    const c: FakeCanvas = {
      width: w,
      height: h,
      clientWidth: 400,
      clientHeight: 200,
      clientLeft: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
      getContext: () => c.ctx,
      toBlob: (cb, type) => cb(new Blob(['x'], { type })),
      ctx: fake2d(log, () => rendering && blankFrames > 0),
    };
    return c;
  };
  const gpu = makeCanvas(800, 400);
  vi.stubGlobal('document', { createElement: () => makeCanvas(0, 0) });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    blankFrames--;
    setTimeout(cb, 0);
    return 0;
  });
  const backend: ChartExportHost['backend'] = {
    resize: (w, h) => log.push(`resize ${w}x${h}`),
  };
  if (opts.clearHook !== false) backend.set_clear_color = (r, g, b, a) => log.push(`clear ${r},${g},${b},${a}`);
  const host: ChartExportHost = {
    canvas: gpu as unknown as HTMLCanvasElement,
    overlay: null,
    theme: VIZ_THEMES.dark,
    backend,
    render: () => {
      rendering = true;
      log.push(`render ${gpu.width}x${gpu.height}`);
    },
  };
  return { log, host, gpu };
}

describe('captureChartCanvas', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders and reads back in one pass at the current ratio', async () => {
    const { log, host } = setup();
    const out = await captureChartCanvas(host);
    expect(out.width).toBe(800);
    expect(log).toEqual(['render 800x400', 'drawImage 800x400 -> 800x400']);
  });

  it('temporarily resizes the backing store for a higher pixel ratio, then restores it', async () => {
    const { log, host, gpu } = setup();
    const out = await captureChartCanvas(host, { pixelRatio: 3 });
    expect([out.width, out.height]).toEqual([1200, 600]);
    expect(log).toEqual([
      'resize 1200x600',
      'render 1200x600',
      'drawImage 1200x600 -> 1200x600',
      'resize 800x400',
      'render 800x400',
    ]);
    expect([gpu.width, gpu.height]).toEqual([800, 400]);
  });

  it('uses an opaque css background as the clear color and restores the theme surface', async () => {
    const { log, host } = setup();
    await captureChartCanvas(host, { background: '#ffffff' });
    const s = VIZ_THEMES.dark.surface;
    expect(log).toEqual(['clear 1,1,1,1', 'render 800x400', 'drawImage 800x400 -> 800x400', `clear ${s.join(',')}`, 'render 800x400']);
  });

  it('renders over black and white for a transparent background', async () => {
    const { log, host } = setup();
    await captureChartCanvas(host, { background: 'transparent' });
    expect(log.slice(0, 6)).toEqual([
      'clear 0,0,0,1',
      'render 800x400',
      'drawImage 800x400 -> 800x400',
      'clear 1,1,1,1',
      'render 800x400',
      'drawImage 800x400 -> 800x400',
    ]);
    expect(log).toContain('putImageData');
  });

  it('keeps the theme surface when the backend has no clear color hook', async () => {
    const { log, host } = setup({ clearHook: false });
    await captureChartCanvas(host, { background: 'transparent' });
    expect(log).toEqual(['render 800x400', 'drawImage 800x400 -> 800x400']);
  });

  it('retries a blank read back on the next frame, then gives up', async () => {
    const a = setup({ blankFrames: 1 });
    await captureChartCanvas(a.host);
    expect(a.log.filter((l) => l.startsWith('render'))).toHaveLength(2);
    vi.unstubAllGlobals();

    const b = setup({ blankFrames: 10 });
    await expect(captureChartCanvas(b.host)).rejects.toThrow(/blank/);
  });

  it('restores size and clear color when rendering throws', async () => {
    const { log, host, gpu } = setup();
    let calls = 0;
    host.render = () => {
      if (calls++ === 0) throw new Error('device lost');
      log.push(`render ${gpu.width}x${gpu.height}`);
    };
    await expect(captureChartCanvas(host, { pixelRatio: 3, background: '#000' })).rejects.toThrow('device lost');
    const s = VIZ_THEMES.dark.surface;
    expect(log).toEqual(['resize 1200x600', 'clear 0,0,0,1', `clear ${s.join(',')}`, 'resize 800x400', 'render 800x400']);
    expect([gpu.width, gpu.height]).toEqual([800, 400]);
  });

  it('encodes with the requested mime type', async () => {
    const { host } = setup();
    const blob = await chartToBlob(host, { format: 'jpeg', quality: 0.8 });
    expect(blob.type).toBe('image/jpeg');
  });
});

describe('VizEngineSDK image export', () => {
  it('rejects without a canvas (fromBackend)', async () => {
    const sdk = VizEngineSDK.fromBackend({ resize() {}, sync_and_render() {} } as unknown as WasmVizEngineBackend);
    await expect(sdk.toImage()).rejects.toThrow(/no canvas/);
  });
});
