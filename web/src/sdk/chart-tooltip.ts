/**
 * Built-in chart tooltip options (`enableNodeInteractions({ tooltip })`). The engine hit-test
 * returns every hovered item; ordering / filtering the rows and formatting values here is DOM
 * presentation only. Events (`'hover'`, `'click'`) keep the unfiltered context.
 */
import { createFormatter, type ChartValueFormat } from './chart-format';
import type { ChartTooltipContext } from './viz-engine-sdk';

export interface ChartTooltipOptions {
  /** Row order by value: `'asc'`, `'desc'` (NaN last), or `'none'` = series order (default) */
  sort?: 'none' | 'asc' | 'desc';
  /**
   * Line / area / stacked bar charts: `true` (default) lists every series at the hovered x /
   * category; `false` only the item closest to the pointer (the GPU markers are unchanged; use
   * `hover: { mode: 'nearest' }` for single-point markers too)
   */
  shared?: boolean;
  /**
   * `'click'`: a click on a hovered item pins the tooltip (hover stops following the pointer);
   * the next click, a press outside the canvas, Escape (canvas focused), wheel / pan, or a new
   * chart unpins it. The pinned tooltip element gets `data-pinned="true"`. Default: off
   */
  pin?: 'click' | false;
  /**
   * Values in the default tooltip (series values, totals, OHLC, cell / slice / box values,
   * scatter y): a spec (`'.2f'`, `'$,.0f'`, `{ maximumFractionDigits: 1 }`; see chart-format.ts)
   * or a function. Default: the y axis `format` where the chart uses it, else a locale number.
   */
  valueFormatter?: ChartValueFormat;
}

/** Tooltip context as displayed: rows filtered (`shared: false`) and sorted (`sort`). */
export function presentTooltipContext(ctx: ChartTooltipContext, o: ChartTooltipOptions | undefined): ChartTooltipContext {
  if (!o || ctx.items.length < 2) return ctx;
  let items = ctx.items;
  if (o.shared === false && (ctx.chartType === 'line' || ctx.chartType === 'bar' || ctx.chartType === 'combo')) {
    // The primary item (closest to the pointer) is the one `details` describes
    const primary = items.find((it) => it.nodeId === ctx.details?.id) ?? items[0];
    items = [primary];
  }
  if (o.sort === 'asc' || o.sort === 'desc') {
    const dir = o.sort === 'asc' ? 1 : -1;
    items = [...items].sort((a, b) => {
      const na = Number.isNaN(a.value);
      const nb = Number.isNaN(b.value);
      return na || nb ? Number(na) - Number(nb) : (a.value - b.value) * dir;
    });
  }
  if (items === ctx.items) return ctx;
  // One row left (`shared: false`): a column total would describe rows no longer shown
  return items.length === 1 && ctx.items.length > 1 ? { ...ctx, items, total: undefined } : { ...ctx, items };
}

/** Function form of `valueFormatter` (undefined = chart defaults). */
export function tooltipValueFormatter(o: ChartTooltipOptions | undefined, locale?: string): ((v: number) => string) | undefined {
  return o?.valueFormatter !== undefined ? createFormatter(o.valueFormatter, locale) : undefined;
}
