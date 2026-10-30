/**
 * Rich text labels (ECharts `label.rich`): a label formatter returns a template like
 * `'{title|Revenue}\n{value|42}{unit|k}'` and `rich` maps style names to text styles.
 *
 * - `{name|text}` styles `text` with `rich[name]`; an unknown name keeps the text plain.
 * - `\n` starts a new line (also inside a run); `\{`, `\}` and `\\` are literal characters.
 * - Runs do not nest: inside a run `{` is text and the first unescaped `}` closes it. A `{`
 *   without a `name|` prefix or a closing brace is literal text (so `{value}` stays as typed).
 *
 * Rendering builds one block per line and one `<span>` per run with `textContent` only (never
 * HTML from user strings), so the image / SVG / PDF exports, which walk the overlay DOM, paint
 * each run with its own font, color and background box. Without `rich` labels are unchanged.
 */
import { cssColor, parseColor, type ColorInput } from './color';

/** Text style of one `rich` entry. Sizes are CSS px. */
export interface RichTextStyle {
  color?: ColorInput;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | 'lighter' | 'bolder' | number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  fontFamily?: string;
  /** Box behind the run (with `padding` / `borderRadius`) */
  backgroundColor?: ColorInput;
  /** `v`, `[vertical, horizontal]` or `[top, right, bottom, left]` */
  padding?: number | [number, number] | [number, number, number, number];
  borderRadius?: number;
  /** Line box height of the run */
  lineHeight?: number;
  /** Horizontal alignment of the line the run starts (first aligned run of a line wins) */
  align?: 'left' | 'center' | 'right';
}

/** Style name -> style (`{name|text}` in label templates). */
export type RichTextStyles = Record<string, RichTextStyle>;

/** One run of a parsed template; `style` is set only for names found in `rich`. */
export interface RichTextRun {
  text: string;
  style?: string;
}

/** Parsed template: lines of runs. */
export type RichTextLines = RichTextRun[][];

/** Label options of charts with a formatter + rich styles (pie, treemap, sunburst, sankey, funnel). */
export interface RichLabelOptions<C> {
  /** Label text (may use `{style|text}` runs of `rich`); default: the chart's own label */
  formatter?: (ctx: C) => string;
  /** Styles of `{style|text}` runs */
  rich?: RichTextStyles;
}

const NAME = /^[A-Za-z0-9_-]+$/;

/** Parses a label template (see the module docs). */
export function parseRichText(template: string, rich: RichTextStyles | undefined): RichTextLines {
  const lines: RichTextLines = [[]];
  const push = (text: string, style?: string) => {
    const parts = text.split('\n');
    parts.forEach((part, k) => {
      if (k > 0) lines.push([]);
      if (!part) return;
      const line = lines[lines.length - 1];
      const last = line[line.length - 1];
      if (last && last.style === style) last.text += part;
      else line.push(style === undefined ? { text: part } : { text: part, style });
    });
  };
  let plain = '';
  let i = 0;
  const s = String(template);
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && '{}\\'.includes(s[i + 1])) {
      plain += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '{') {
      const bar = s.indexOf('|', i + 1);
      const name = bar > 0 ? s.slice(i + 1, bar) : '';
      if (bar > 0 && NAME.test(name)) {
        // Run text up to the first unescaped `}`
        let text = '';
        let j = bar + 1;
        let closed = false;
        while (j < s.length) {
          if (s[j] === '\\' && j + 1 < s.length && '{}\\'.includes(s[j + 1])) {
            text += s[j + 1];
            j += 2;
            continue;
          }
          if (s[j] === '}') {
            closed = true;
            break;
          }
          text += s[j++];
        }
        if (closed) {
          push(plain);
          plain = '';
          push(text, rich && Object.prototype.hasOwnProperty.call(rich, name) ? name : undefined);
          i = j + 1;
          continue;
        }
      }
    }
    plain += c;
    i++;
  }
  push(plain);
  return lines;
}

/** Text of a parse without styles (lines joined by `\n`). */
export function richTextPlain(lines: RichTextLines): string {
  return lines.map((l) => l.map((r) => r.text).join('')).join('\n');
}

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Throws for a malformed `rich` option (at render time, before the chart is replaced). */
export function validateRichStyles(rich: unknown): void {
  if (rich === undefined) return;
  if (rich === null || typeof rich !== 'object' || Array.isArray(rich)) throw new TypeError('rich: expected an object of named text styles');
  for (const [name, st] of Object.entries(rich as Record<string, unknown>)) {
    if (!st || typeof st !== 'object') throw new TypeError(`rich.${name}: expected a style object`);
    const o = st as RichTextStyle;
    for (const key of ['fontSize', 'lineHeight', 'borderRadius'] as const) {
      const v = o[key];
      if (v !== undefined && !(finite(v) && (v as number) >= 0 && (key !== 'fontSize' || (v as number) > 0))) {
        throw new RangeError(`rich.${name}.${key}: expected a ${key === 'fontSize' ? 'positive' : 'non-negative'} number`);
      }
    }
    if (o.padding !== undefined) {
      const p = o.padding;
      const ok = finite(p) ? (p as number) >= 0 : Array.isArray(p) && (p.length === 2 || p.length === 4) && p.every((v) => finite(v) && v >= 0);
      if (!ok) throw new RangeError(`rich.${name}.padding: expected a number, [v, h] or [top, right, bottom, left]`);
    }
    if (o.align !== undefined && o.align !== 'left' && o.align !== 'center' && o.align !== 'right') {
      throw new RangeError(`rich.${name}.align: expected 'left', 'center' or 'right'`);
    }
    for (const key of ['color', 'backgroundColor'] as const) {
      const v = o[key];
      if (v === undefined) continue;
      try {
        parseColor(v);
      } catch {
        throw new TypeError(`rich.${name}.${key}: invalid color ${JSON.stringify(v)}`);
      }
    }
  }
}

/** Throws for a malformed `label: { formatter?, rich? }` option (`where`: message prefix). */
export function validateRichLabel(label: unknown, where: string): void {
  if (label === undefined) return;
  if (label === null || typeof label !== 'object' || Array.isArray(label)) throw new TypeError(`${where}: label: expected { formatter?, rich? }`);
  const o = label as RichLabelOptions<unknown>;
  if (o.formatter !== undefined && typeof o.formatter !== 'function') throw new TypeError(`${where}: label.formatter: expected a function`);
  validateRichStyles(o.rich);
}

/** `[top, right, bottom, left]` of a padding option. */
export function richPadding(p: RichTextStyle['padding']): [number, number, number, number] {
  if (p === undefined) return [0, 0, 0, 0];
  if (typeof p === 'number') return [p, p, p, p];
  return p.length === 2 ? [p[0], p[1], p[0], p[1]] : [p[0], p[1], p[2], p[3]];
}

/** Whether a run needs its own box (padding / background / radius / line height). */
function boxed(st: RichTextStyle): boolean {
  return st.backgroundColor !== undefined || st.padding !== undefined || st.borderRadius !== undefined || st.lineHeight !== undefined;
}

/**
 * Replaces `el`'s content with the parsed lines: a `.charturbo-sdk-rich-line` block per line and
 * a span per run (styled runs carry their style; others inherit the label's look).
 */
export function renderRichText(el: HTMLElement, lines: RichTextLines, rich: RichTextStyles | undefined): void {
  el.replaceChildren();
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'charturbo-sdk-rich-line';
    row.style.whiteSpace = 'pre';
    let aligned = false;
    for (const run of line) {
      const span = document.createElement('span');
      span.textContent = run.text;
      const st = run.style !== undefined ? rich?.[run.style] : undefined;
      if (st) {
        span.dataset.rich = run.style;
        const s = span.style;
        if (st.color !== undefined) s.color = cssColor(st.color);
        if (st.fontSize !== undefined) s.fontSize = `${st.fontSize}px`;
        if (st.fontWeight !== undefined) s.fontWeight = String(st.fontWeight);
        if (st.fontStyle !== undefined) s.fontStyle = st.fontStyle;
        if (st.fontFamily !== undefined) s.fontFamily = st.fontFamily;
        if (st.lineHeight !== undefined) s.lineHeight = `${st.lineHeight}px`;
        if (boxed(st)) {
          s.display = 'inline-block';
          s.verticalAlign = 'middle';
        }
        if (st.backgroundColor !== undefined) s.background = cssColor(st.backgroundColor);
        if (st.padding !== undefined) s.padding = richPadding(st.padding).map((v) => `${v}px`).join(' ').replace(/^(\S+) (\S+) \1 \2$/, '$1 $2');
        if (st.borderRadius !== undefined) s.borderRadius = `${st.borderRadius}px`;
        if (st.align && !aligned) {
          row.style.textAlign = st.align;
          aligned = true;
        }
      }
      row.appendChild(span);
    }
    el.appendChild(row);
  }
}

/** Base font of a label (what unstyled runs inherit). */
export interface RichTextBase {
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  /** Line box height of unstyled text */
  lineHeight: number;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, font: string, fontSize: number): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? (document.createElement('canvas').getContext?.('2d') ?? null) : null;
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx && typeof measureCtx.measureText === 'function') {
    measureCtx.font = font;
    const w = measureCtx.measureText(text).width;
    if (Number.isFinite(w) && w > 0) return w;
  }
  return text.length * fontSize * 0.6;
}

/**
 * Layout box (CSS px) of rendered rich text: line widths are the run widths plus horizontal
 * padding; a line is as tall as its tallest run (`lineHeight`, else 1.2 em, plus vertical
 * padding for boxed runs) and at least the base line height. Used for label fit / collision
 * tests and reserved room.
 */
export function measureRichText(lines: RichTextLines, rich: RichTextStyles | undefined, base: RichTextBase): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const line of lines) {
    let w = 0;
    let h = base.lineHeight;
    for (const run of line) {
      const st = run.style !== undefined ? rich?.[run.style] : undefined;
      const size = st?.fontSize ?? base.fontSize;
      const font = `${st?.fontStyle ?? 'normal'} ${st?.fontWeight ?? base.fontWeight} ${size}px ${st?.fontFamily ?? base.fontFamily}`;
      const [pt, pr, pb, pl] = richPadding(st?.padding);
      w += textWidth(run.text, font, size) + pl + pr;
      if (st) h = Math.max(h, (st.lineHeight ?? (st.fontSize !== undefined || boxed(st) ? size * 1.2 : 0)) + pt + pb);
    }
    width = Math.max(width, w);
    height += h;
  }
  return { width, height };
}
