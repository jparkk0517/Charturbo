/**
 * Chart annotations (reference lines, bands, point markers, text) for 2D line / bar / scatter
 * charts. The engine maps data units to the screen, clips, and draws the marks on the GPU; this
 * module only encodes the list for the engine and lays out the DOM labels at the anchors the
 * engine reports (`chart_annotation_labels`, re-read only when its revision changes).
 */
import { parseColor, type ColorInput, type RgbaTuple } from './color';
import type { VizTheme, WasmVizEngineBackend } from './viz-engine-sdk';

/** x in data units: sample index (line without `x`), x value / `Date` (line with `x`, scatter), category index (bar). */
export type AnnotationX = number | Date;

/** Style fields shared by every annotation kind. */
export interface ChartAnnotationBase {
  /**
   * Line / marker / band color as a tuple or CSS color (default: theme baseline for lines and
   * points, crosshair for bands)
   */
  color?: ColorInput;
  /** Stroke width in CSS px (lines, band borders; bands default to 0 = no border) or point radius (default 5) */
  width?: number;
  /** Dashed stroke: dash length in CSS px, or `true` for 6 px */
  dash?: number | boolean;
  /** Alpha multiplier (bands default to 0.18, others 1) */
  opacity?: number;
  /** DOM label text (small pill) */
  label?: string;
  /** Label anchor along the line / band: start = left / bottom, end = right / top (default) */
  labelPosition?: 'start' | 'end' | 'center';
  /** `'below'` (default): with the gridlines, under the series; `'above'`: over the series */
  z?: 'below' | 'above';
  /** y axis of `y` / y bands in a dual-axis line chart (default: `'left'`) */
  yAxis?: 'left' | 'right';
}

export type ChartAnnotation =
  | (ChartAnnotationBase & { type: 'hline'; y: number })
  | (ChartAnnotationBase & { type: 'vline'; x: AnnotationX })
  /** `from` / `to` may be ±Infinity (band reaches the plot edge) */
  | (ChartAnnotationBase & { type: 'yband'; from: number; to: number })
  | (ChartAnnotationBase & { type: 'xband'; from: AnnotationX; to: AnnotationX })
  | (ChartAnnotationBase & { type: 'point'; x: AnnotationX; y: number })
  | (ChartAnnotationBase & { type: 'text'; x: AnnotationX; y: number; text: string });

/** Engine kind codes (`set_chart_annotations`). */
const KINDS = { hline: 0, vline: 1, yband: 2, xband: 3, point: 4, text: 5 } as const;
const LABEL_POSITIONS = { start: 0, end: 1, center: 2 } as const;

export interface EncodedAnnotations {
  kinds: Uint8Array;
  coords: Float64Array;
  colors: Float32Array;
  widths: Float32Array;
  dash: Float32Array;
  opacity: Float32Array;
  layers: Uint8Array;
  labelPositions: Uint8Array;
  /** 0 = left y axis, 1 = right (`set_chart_annotation_y_axes`) */
  yAxes: Uint8Array;
}

const num = (v: AnnotationX): number => (v instanceof Date ? v.getTime() : Number(v));

/** Default color of an annotation under `theme`. */
export function annotationColor(a: ChartAnnotation, theme: VizTheme): RgbaTuple {
  if (a.color) return parseColor(a.color);
  return a.type === 'yband' || a.type === 'xband' ? theme.crosshair : theme.baseline;
}

/** Flat typed arrays for `set_chart_annotations` (NaN = engine default). */
export function encodeAnnotations(list: readonly ChartAnnotation[], theme: VizTheme): EncodedAnnotations {
  const n = list.length;
  const out: EncodedAnnotations = {
    kinds: new Uint8Array(n),
    coords: new Float64Array(n * 4).fill(NaN),
    colors: new Float32Array(n * 4),
    widths: new Float32Array(n).fill(NaN),
    dash: new Float32Array(n),
    opacity: new Float32Array(n).fill(NaN),
    layers: new Uint8Array(n),
    labelPositions: new Uint8Array(n).fill(LABEL_POSITIONS.end),
    yAxes: new Uint8Array(n),
  };
  list.forEach((a, i) => {
    out.kinds[i] = KINDS[a.type];
    const c =
      a.type === 'hline'
        ? [a.y]
        : a.type === 'vline'
          ? [num(a.x)]
          : a.type === 'yband' || a.type === 'xband'
            ? [num(a.from), num(a.to)]
            : [num(a.x), a.y];
    out.coords.set(c, i * 4);
    out.colors.set(annotationColor(a, theme), i * 4);
    if (a.width !== undefined) out.widths[i] = a.width;
    out.dash[i] = a.dash === true ? 6 : typeof a.dash === 'number' ? a.dash : 0;
    if (a.opacity !== undefined) out.opacity[i] = a.opacity;
    out.layers[i] = a.z === 'above' ? 1 : 0;
    out.labelPositions[i] = LABEL_POSITIONS[a.labelPosition ?? 'end'];
    out.yAxes[i] = a.yAxis === 'right' ? 1 : 0;
  });
  return out;
}

/** Text of an annotation's DOM label (`undefined` = none). */
function labelText(a: ChartAnnotation): string | undefined {
  return a.type === 'text' ? a.text : a.label;
}

/** CSS transform placing a label next to its anchor (off the line, inside the plot). */
export function labelTransform(a: ChartAnnotation): string {
  const pos = a.labelPosition ?? 'end';
  switch (a.type) {
    case 'hline': {
      // Above the line, aligned to the plot edge
      const x = pos === 'end' ? '-100%' : pos === 'center' ? '-50%' : '0px';
      const dx = pos === 'end' ? ' - 4px' : pos === 'start' ? ' + 4px' : '';
      return `translate(calc(${x}${dx}), calc(-100% - 3px))`;
    }
    case 'vline': {
      // Right of the line, hanging from the top / standing on the bottom
      const y = pos === 'end' ? '4px' : pos === 'center' ? '-50%' : 'calc(-100% - 4px)';
      return `translate(4px, ${y})`;
    }
    case 'yband': {
      const x = pos === 'end' ? 'calc(-100% - 4px)' : pos === 'center' ? '-50%' : '4px';
      return `translate(${x}, -50%)`;
    }
    case 'xband': {
      const y = pos === 'end' ? '4px' : pos === 'center' ? '-50%' : 'calc(-100% - 4px)';
      return `translate(-50%, ${y})`;
    }
    case 'point': {
      const r = a.width ?? 5;
      return `translate(-50%, calc(-100% - ${r + 4}px))`;
    }
    case 'text':
      return 'translate(-50%, -50%)';
  }
}

function cssColor(c: RgbaTuple): string {
  const [r, g, b] = c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/** DOM labels of the chart annotations inside the chart overlay root. */
export class AnnotationLabelLayer {
  private els: HTMLDivElement[] = [];
  /** Engine label revision the DOM was laid out for (-1 = stale) */
  private revision = -1;

  constructor(private readonly root: HTMLElement) {}

  /** Forces a re-layout on the next `update` (list / theme changed). */
  invalidate(): void {
    this.revision = -1;
  }

  /** Re-positions labels when the engine moved their anchors. */
  update(backend: WasmVizEngineBackend, list: readonly ChartAnnotation[], theme: VizTheme): void {
    const rev = backend.chart_annotation_labels_revision?.() ?? 0;
    if (rev === this.revision) return;
    this.revision = rev;
    const a = backend.chart_annotation_labels?.();
    const count = a && a.length >= 1 ? a[0] : 0;
    let used = 0;
    for (let k = 0; k < count; k++) {
      const id = a![1 + k * 4];
      const ann = list[id];
      const text = ann && labelText(ann);
      if (!ann || !text || a![4 + k * 4] === 0) continue;
      let el = this.els[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'viz-sdk-annotation-label';
        Object.assign(el.style, {
          position: 'absolute',
          fontSize: '11px',
          lineHeight: '16px',
          padding: '0 6px',
          borderRadius: '8px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          fontVariantNumeric: 'tabular-nums',
        });
        this.root.appendChild(el);
        this.els.push(el);
      }
      used++;
      const plain = ann.type === 'text';
      Object.assign(el.style, {
        display: 'block',
        left: `${a![2 + k * 4]}px`,
        top: `${a![3 + k * 4]}px`,
        transform: labelTransform(ann),
        color: theme.textPrimary,
        // Text annotations read as plain text; line / band / point labels as small pills
        background: plain ? 'none' : theme.tooltipBackground,
        border: plain ? 'none' : `1px solid ${theme.tooltipBorder}`,
        borderLeft: plain ? 'none' : `3px solid ${cssColor(annotationColor(ann, theme))}`,
      });
      el.textContent = text;
    }
    for (let k = used; k < this.els.length; k++) this.els[k].style.display = 'none';
  }
}
