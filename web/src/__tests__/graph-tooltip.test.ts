// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
// The a11y layer has its own tests: replaced by an inert stand-in
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
import { GRAPH_TOOLTIP_MAX_ATTRIBUTES, graphTooltipHtml, graphTooltipStrings } from '../sdk/graph-tooltip';
import { VIZ_THEMES, VizEngineSDK, escapeHtml, type NodeDetails } from '../sdk/viz-engine-sdk';
import { fakeCanvas, graphBackend } from './graph-backend';

const XSS = '<img src=x onerror="window.__pwned = 1">';

const details = (over: Partial<NodeDetails> = {}): NodeDetails => ({
  id: 7,
  label: 'api-01',
  position: [1.25, -2, 3],
  mass: 1,
  clusterId: 2,
  color: [0.2, 0.5, 0.9, 1],
  degree: 1234,
  selected: false,
  pinned: false,
  neighbors: [1, 2],
  metadata: { category: 'Gateway', tags: ['prod'], attributes: { region: 'eu', rps: 4200 } },
  ...over,
});

/** Parses tooltip HTML the way the browser does when it is assigned to `innerHTML`. */
const render = (html: string) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
};

describe('graphTooltipHtml', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (window as { __pwned?: number }).__pwned;
  });

  it('renders malicious label / category / tags / attributes as text', () => {
    const el = render(
      graphTooltipHtml(
        details({ label: XSS, metadata: { category: XSS, tags: [XSS], attributes: { [XSS]: XSS } } }),
        VIZ_THEMES.dark,
        'en-US'
      )
    );
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelectorAll('[onerror]').length).toBe(0);
    // label, category, tags, attribute key + value
    expect(el.textContent!.split(XSS).length - 1).toBe(5);
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('English by default, Korean for ko locales; numbers follow the locale', () => {
    expect(graphTooltipStrings()).toBe(graphTooltipStrings('en-US'));
    expect(graphTooltipStrings('ko')).toBe(graphTooltipStrings('ko-KR'));
    const en = render(graphTooltipHtml(details(), VIZ_THEMES.dark, 'en-US', true)).textContent!;
    expect(en).toContain('Degree');
    expect(en).toContain('1,234');
    expect(en).toContain('(1.3, -2.0, 3.0)');
    expect(en).toContain('Gateway · Cluster 2');
    expect(en).toContain('Click to highlight neighbors');
    expect(en).not.toMatch(/[가-힣]/);
    const ko = render(graphTooltipHtml(details(), VIZ_THEMES.dark, 'ko-KR', true)).textContent!;
    expect(ko).toContain('연결 차수');
    expect(ko).toContain('클러스터 2');
    expect(ko).toContain('클릭하면 이웃 노드를 강조합니다');
    const de = render(graphTooltipHtml(details(), VIZ_THEMES.dark, 'de-DE')).textContent!;
    expect(de).toContain('1.234');
    expect(de).toContain('(1,3, -2,0, 3,0)');
    expect(de).not.toContain('Click');
  });

  it('uses theme text tokens, skips the fallback category and caps attribute rows', () => {
    const attributes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    const html = graphTooltipHtml(details({ metadata: { category: 'Cluster 2', attributes } }), VIZ_THEMES.light);
    expect(html).toContain(VIZ_THEMES.light.textPrimary);
    expect(html).not.toContain('#fff');
    const text = render(html).textContent!;
    expect(text).not.toContain('Cluster 2 · Cluster 2');
    expect(text).toContain(`k${GRAPH_TOOLTIP_MAX_ATTRIBUTES - 1}`);
    expect(text).not.toContain(`k${GRAPH_TOOLTIP_MAX_ATTRIBUTES}`);
  });

  it('escapeHtml is exported for custom formatters', () => {
    expect(escapeHtml(XSS)).not.toContain('<');
    expect(render(escapeHtml(XSS)).textContent).toBe(XSS);
  });
});

describe('built-in tooltips escape data (SDK hover)', () => {
  afterEach(() => document.body.replaceChildren());
  const tooltip = () => document.body.querySelector<HTMLElement>('.viz-sdk-node-tooltip')!;

  it('graph node tooltip follows the SDK locale and renders labels as text', () => {
    const { backend, pick } = graphBackend();
    const sdk = VizEngineSDK.fromBackend(backend);
    sdk.setNodeMetadata([{ label: XSS, category: XSS }]);
    const { canvas, handlers } = fakeCanvas();
    sdk.enableNodeInteractions(canvas);
    pick(0);
    handlers.pointermove({ buttons: 0, pointerType: 'mouse', clientX: 10, clientY: 10 });
    expect(tooltip().style.display).toBe('block');
    expect(tooltip().querySelector('img')).toBeNull();
    expect(tooltip().textContent).toContain(XSS);
    expect(tooltip().textContent).toContain('Degree');
    sdk.setLocale('ko-KR');
    pick(1);
    handlers.pointermove({ buttons: 0, pointerType: 'mouse', clientX: 12, clientY: 10 });
    expect(tooltip().textContent).toContain('연결 차수');
  });

  it('line chart tooltip escapes series names and x labels', () => {
    const { backend, setHit } = graphBackend();
    const sdk = VizEngineSDK.fromBackend(backend);
    const { canvas, handlers } = fakeCanvas();
    sdk.enableNodeInteractions(canvas);
    sdk.renderLineChart([{ name: XSS, values: [1, 2, 3] }], { xLabelPrefix: XSS });
    // Engine hit: primary slot 0, 1 item: series 0, sample 1, value 2, global id 1
    setHit([0, 0, 1, 0, 1, 2, 1]);
    handlers.pointermove({ buttons: 0, pointerType: 'mouse', clientX: 10, clientY: 10 });
    expect(tooltip().style.display).toBe('block');
    expect(tooltip().querySelector('img')).toBeNull();
    expect(tooltip().textContent!.split(XSS).length - 1).toBe(2);
  });
});
