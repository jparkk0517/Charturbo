/**
 * Fixture page of the visual regression harness: `index.html?fixture=<name>&backend=webgpu|webgl2
 * [&p=key:value,...]` renders one fixture and publishes `window.__visual` for the runner
 * (e2e/run-visual.mjs, Chrome DevTools Protocol).
 *
 * `backend=webgl2` hides `navigator.gpu` before the engine starts, so wgpu's browser instance
 * falls back to its GL backend exactly like a browser without WebGPU.
 */

import { VIZ_THEMES } from '../src/index';
import { FIXTURES } from './fixtures';
import type { FixtureContext } from './fixtures';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualState {
  done: boolean;
  ok: boolean;
  fixture: string;
  requestedBackend: string;
  backend?: string;
  error?: string;
  ms?: number;
  /** `?probe=1`: what this browser can render with */
  probe?: { webgpu: boolean; webgl2: boolean };
}

declare global {
  interface Window {
    __visual?: VisualState;
    __visualFixtures?: string[];
    /** Shows the canvas-only (overlay hidden) or full view; resolves the clip rect after 2 frames */
    __visualMode?: (mode: 'canvas' | 'full') => Promise<Rect>;
  }
}

const query = new URLSearchParams(location.search);
const name = query.get('fixture') ?? '';
const requested = query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
const params: Record<string, string> = {};
for (const pair of (query.get('p') ?? '').split(',')) {
  const at = pair.indexOf(':');
  if (at > 0) params[pair.slice(0, at)] = pair.slice(at + 1);
}

if (requested === 'webgl2') {
  Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined });
}

window.__visualFixtures = FIXTURES.map((f) => f.name);

const card = document.getElementById('card') as HTMLElement;
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** Union of every canvas in the card (one chart, or the sparkline grid). */
function canvasRect(): Rect {
  const rects = [...card.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

window.__visualMode = async (mode) => {
  document.body.classList.toggle('canvas-only', mode === 'canvas');
  await frames(2);
  return mode === 'canvas' ? canvasRect() : rectOf(card);
};

async function run(): Promise<VisualState> {
  const state: VisualState = { done: true, ok: false, fixture: name, requestedBackend: requested };
  const fixture = FIXTURES.find((f) => f.name === name);
  if (!fixture) return { ...state, error: name ? `unknown fixture ${name}` : 'no fixture' };
  // Card = theme surface, so the full shot has no seam around the canvas
  const [r, g, b] = VIZ_THEMES[fixture.theme].surface.map((c) => Math.round(c * 255));
  card.style.background = `rgb(${r}, ${g}, ${b})`;
  const ctx: FixtureContext = { card, theme: fixture.theme, backend: requested, params };
  const t0 = performance.now();
  try {
    const result = await fixture.render(ctx);
    await frames(3);
    return { ...state, ok: true, backend: result.backend, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    return { ...state, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

async function probe(): Promise<VisualState> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  let webgpu = false;
  try {
    webgpu = !!(await gpu?.requestAdapter());
  } catch {
    webgpu = false;
  }
  const webgl2 = !!document.createElement('canvas').getContext('webgl2');
  return { done: true, ok: true, fixture: '', requestedBackend: requested, probe: { webgpu, webgl2 } };
}

if (query.has('probe')) {
  void probe().then((s) => (window.__visual = s));
} else if (name) {
  void run().then((s) => (window.__visual = s));
} else {
  window.__visual = { done: true, ok: true, fixture: '', requestedBackend: requested };
}
