/**
 * Loading indicator (ECharts `showLoading` / `hideLoading`): a mask over the canvas box with a
 * spinner and a status text. It stays until `hideLoading` (rendering does not hide it), marks
 * the chart container `aria-busy` and announces the text through a polite live region. The
 * spinner is static under `prefers-reduced-motion`. Image / SVG / PDF exports never include it
 * (it is outside the chart overlay and marked `data-charturbo-export="false"`).
 */
import { cssColor, parseColor, type ColorInput } from './color';
import type { CharturboTheme } from './charturbo';
import { prefersReducedMotion } from './chart-animation';

export interface ChartLoadingOptions {
  /** Status text (default: `'Loading…'` in the chart language) */
  text?: string;
  /** Mask over the chart (default: the theme surface at 80% opacity) */
  maskColor?: ColorInput;
  /** Spinner color (default: the first palette color) */
  color?: ColorInput;
  /** Text color (default: theme primary text) */
  textColor?: ColorInput;
  /** Text size in CSS px (default 12) */
  fontSize?: number;
  /** Spinner (default true) */
  spinner?: boolean;
  /** Milliseconds before the mask appears (default 0); `aria-busy` is set at once */
  delay?: number;
}

/** Throws for malformed options (before the current indicator changes). */
export function validateLoadingOptions(o: unknown): void {
  if (o === undefined) return;
  if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new TypeError('showLoading: options: expected an object');
  const v = o as ChartLoadingOptions;
  if (v.text !== undefined && typeof v.text !== 'string') throw new TypeError('showLoading: text: expected a string');
  if (v.fontSize !== undefined && !(typeof v.fontSize === 'number' && Number.isFinite(v.fontSize) && v.fontSize > 0)) {
    throw new RangeError('showLoading: fontSize: expected a positive number');
  }
  if (v.delay !== undefined && !(typeof v.delay === 'number' && Number.isFinite(v.delay) && v.delay >= 0)) {
    throw new RangeError('showLoading: delay: expected a non-negative number of milliseconds');
  }
  if (v.spinner !== undefined && typeof v.spinner !== 'boolean') throw new TypeError('showLoading: spinner: expected a boolean');
  for (const key of ['maskColor', 'color', 'textColor'] as const) {
    if (v[key] === undefined) continue;
    try {
      parseColor(v[key]);
    } catch {
      throw new TypeError(`showLoading: ${key}: invalid color ${JSON.stringify(v[key])}`);
    }
  }
}

const STYLE_ID = 'charturbo-sdk-loading-style';
const SPIN = 'charturbo-sdk-spin 0.9s linear infinite';

/** Keyframes of the spinner (once per document); the media query stops it for reduced motion. */
function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent =
    '@keyframes charturbo-sdk-spin{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion: reduce){.charturbo-sdk-loading-spinner{animation:none !important}}';
  (doc.head ?? doc.documentElement).appendChild(style);
}

/**
 * Mask element of one chart. `canvas()` locates the chart (the mask covers its box inside its
 * parent, the container that gets `aria-busy`); `theme()` / `text()` give the defaults.
 */
export class ChartLoadingLayer {
  private el: HTMLDivElement | null = null;
  private options: ChartLoadingOptions | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Container + its `aria-busy` before `show` (null = absent) */
  private busy: { container: HTMLElement; previous: string | null } | null = null;

  constructor(
    private readonly canvas: () => HTMLCanvasElement | null,
    private readonly theme: () => CharturboTheme,
    private readonly text: () => string
  ) {}

  isShown(): boolean {
    return this.options !== null;
  }

  /** Shows (or updates) the indicator; options must be valid (`validateLoadingOptions`). */
  show(options: ChartLoadingOptions = {}): void {
    const wasShown = this.options !== null;
    this.options = { ...options };
    const container = this.canvas()?.parentElement ?? null;
    if (container && this.busy?.container !== container) {
      this.releaseBusy();
      this.busy = { container, previous: container.getAttribute('aria-busy') };
    }
    container?.setAttribute('aria-busy', 'true');
    // A pending delay keeps its deadline (re-renders with new options do not postpone the mask)
    if (wasShown && this.timer !== null) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const delay = options.delay ?? 0;
    // Updating a visible indicator never hides it again for a delay
    if (delay > 0 && !(wasShown && this.el)) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.mount();
      }, delay);
      return;
    }
    this.mount();
  }

  hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.options = null;
    this.el?.remove();
    this.el = null;
    this.releaseBusy();
  }

  /** Re-applies theme / locale defaults to a shown indicator. */
  restyle(): void {
    if (this.el && this.options) this.build(this.el, this.options);
  }

  /** Keeps the mask on the canvas box (after resizes). */
  layout(): void {
    const el = this.el;
    const canvas = this.canvas();
    if (!el || !canvas) return;
    Object.assign(el.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${canvas.offsetWidth}px`, height: `${canvas.offsetHeight}px` });
  }

  dispose(): void {
    this.hide();
  }

  private releaseBusy(): void {
    const b = this.busy;
    if (!b) return;
    if (b.previous === null) b.container.removeAttribute('aria-busy');
    else b.container.setAttribute('aria-busy', b.previous);
    this.busy = null;
  }

  private mount(): void {
    const canvas = this.canvas();
    const parent = canvas?.parentElement;
    if (!this.options || !canvas || !parent) return;
    if (!this.el) {
      ensureStyle(parent.ownerDocument);
      const el = parent.ownerDocument.createElement('div');
      el.className = 'charturbo-sdk-loading';
      el.dataset.charturboExport = 'false';
      parent.appendChild(el);
      this.el = el;
    }
    this.build(this.el, this.options);
    this.layout();
  }

  private build(el: HTMLDivElement, o: ChartLoadingOptions): void {
    const t = this.theme();
    const [r, g, b] = t.surface;
    Object.assign(el.style, {
      position: 'absolute',
      // Above the chart overlay (5), below the tooltip
      zIndex: '6',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      pointerEvents: 'auto',
      fontFamily: t.fontFamily,
      background: cssColor(o.maskColor ?? [r, g, b, 0.8]),
    });
    // The status element stays (a live region announces changes of an existing node)
    let text = el.querySelector<HTMLDivElement>(':scope > .charturbo-sdk-loading-text');
    if (!text) {
      text = el.ownerDocument.createElement('div');
      text.className = 'charturbo-sdk-loading-text';
      text.setAttribute('role', 'status');
      text.setAttribute('aria-live', 'polite');
      el.appendChild(text);
    }
    el.querySelector(':scope > .charturbo-sdk-loading-spinner')?.remove();
    if (o.spinner ?? true) {
      const spinner = el.ownerDocument.createElement('div');
      spinner.className = 'charturbo-sdk-loading-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      const color = cssColor(o.color ?? t.palette[0] ?? [0.4, 0.6, 1, 1]);
      Object.assign(spinner.style, {
        width: '28px',
        height: '28px',
        boxSizing: 'border-box',
        borderRadius: '50%',
        border: '3px solid transparent',
        borderTopColor: color,
        borderRightColor: color,
        animation: prefersReducedMotion() ? 'none' : SPIN,
      });
      el.insertBefore(spinner, text);
    }
    const label = o.text ?? this.text();
    if (text.textContent !== label) text.textContent = label;
    Object.assign(text.style, { color: o.textColor !== undefined ? cssColor(o.textColor) : t.textPrimary, fontSize: `${o.fontSize ?? 12}px`, whiteSpace: 'nowrap' });
  }
}
