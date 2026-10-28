/**
 * DOM / text helpers and a11y hook types shared by the business chart modules (chart-radar.ts,
 * chart-gauge.ts, chart-funnel.ts, chart-waterfall.ts; dispatch in chart-business.ts).
 */
import type { RgbaTuple } from './color';
import type { A11yFocus, ChartDataTable } from './chart-a11y';
import type { CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { getMessages, resolveLocale } from './i18n';

/** CSS `rgb()` of a tuple (alpha ignored: swatches are opaque). */
export function rgbCss(c: RgbaTuple | undefined): string {
  const [r, g, b] = (c ?? [0.5, 0.5, 0.5, 1]).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Escapes text for tooltip HTML. */
export function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Percent text with one decimal in the locale (a dash when undefined). */
export function percentText(p: number, locale?: string): string {
  return Number.isFinite(p)
    ? `${p.toLocaleString(resolveLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : getMessages(locale).common.dash;
}

/** Absolutely positioned, non-interactive overlay element. */
export function overlayDiv(className: string, style: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', whiteSpace: 'nowrap', ...style });
  return el;
}

/**
 * Places `el` at an engine anchor: `ha` -1 / 0 / 1 = the text ends at / is centered on / starts
 * at `x`; `va` -1 / 0 / 1 = above / centered on / below `y`.
 */
export function placeAt(el: HTMLElement, x: number, y: number, ha: number, va: number): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  const tx = ha > 0 ? '0' : ha < 0 ? '-100%' : '-50%';
  const ty = va > 0 ? '0' : va < 0 ? '-100%' : '-50%';
  el.style.transform = `translate(${tx}, ${ty})`;
}

/**
 * Tooltip row: label on the left, value (HTML) on the right (theme text tokens). `labelHtml`:
 * the label is already HTML (e.g. a status icon span), else it is escaped.
 */
export function tooltipRow(theme: CharturboTheme, label: string, value: string, swatch?: string, labelHtml = false): string {
  const sw = swatch
    ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;flex:none;background:${swatch};"></span>`
    : '';
  return `
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;">
          <span style="display:flex;align-items:center;color:${theme.textSecondary};">${sw}${labelHtml ? label : esc(label)}</span>
          <span style="color:${theme.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;">${value}</span>
        </div>`;
}

/** Tooltip header line (muted). */
export function tooltipHeader(theme: CharturboTheme, text: string): string {
  return `<div style="color:${theme.textMuted};font-size:11px;margin-bottom:4px;">${esc(text)}</div>`;
}

/** DOM label layer of a business chart (re-laid out when the engine's label revision changes). */
export interface BusinessLabelLayer {
  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme, locale?: string): void;
  /** Forces a re-layout on the next `update` (theme / locale change) */
  invalidate(): void;
  remove(): void;
}

/** Chart-kind specific text / navigation hooks of an a11y model (see chart-a11y.ts). */
export interface A11yCustomModel {
  /** Table caption / kind name, e.g. `'Radar'` */
  kindLabel: string;
  summary(): string;
  /** Description sentences (before the keyboard help) */
  description(): string[];
  help: string;
  announce(focus: A11yFocus): string;
  /** Keyboard step (default: the generic series / index navigation) */
  step?(focus: A11yFocus | null, key: string): A11yFocus | null;
  /** Data table (default: the generic wide table of `series`) */
  table?(pick: (n: number) => number[]): ChartDataTable;
  /** Header of the category column of the generic table */
  xHeader?: string;
  /** Enter / Escape: drill (handled) or `null` (default handling; hierarchy charts) */
  key?(focus: A11yFocus | null, key: string): { focus: A11yFocus | null } | null;
  /** Engine hover of the focused item by id (no pointer; hierarchy / flow charts) */
  hover?(focus: A11yFocus): Float64Array | undefined;
}

/** Inputs `buildA11yModel` hands to the business model builders. */
export interface A11yCommon {
  title?: string;
  description?: string;
  xTitle?: string;
  yTitle?: string;
  formatValue: (v: number) => string;
  /** Chart locale of built-in text (`getMessages(locale)`); absent = page / browser language */
  locale?: string;
}

/** Keyboard step over `count` stops of one series (Left / Right / Up / Down / Page / Home / End). */
export function stepSingle(focus: A11yFocus | null, key: string, count: number): A11yFocus | null {
  if (count < 1) return null;
  if (!focus) return { series: 0, index: key === 'End' ? count - 1 : 0 };
  let i = focus.index;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      i -= 1;
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      i += 1;
      break;
    case 'PageUp':
      i += 10;
      break;
    case 'PageDown':
      i -= 10;
      break;
    case 'Home':
      i = 0;
      break;
    case 'End':
      i = count - 1;
      break;
  }
  return { series: 0, index: Math.max(0, Math.min(count - 1, i)) };
}
