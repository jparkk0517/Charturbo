/**
 * Chart legend placement and paging. The legend sits on one side of the plot (the padding
 * reserves that side); with `overflow: 'scroll'` it keeps one row (top / bottom) or one column
 * (left / right) and pages the entries that do not fit behind ‹ › buttons, so a long legend never
 * covers the plot. Page breaks use the measured entry sizes and keep whole entries per page.
 */

export type ChartLegendPosition = 'top' | 'bottom' | 'left' | 'right';

/** Height a top / bottom legend row reserves (CSS px). */
export const LEGEND_ROW_PX = 28;
/** Gap between a side legend column and the plot / canvas edge (CSS px). */
export const LEGEND_SIDE_GAP_PX = 8;
/** Room the pager takes at the end of a row / column (CSS px). */
const PAGER_ROW_PX = 72;
const PAGER_COLUMN_PX = 26;
/** Gap between entries (CSS px): row gap / column gap. */
const ROW_GAP_PX = 14;
const COLUMN_GAP_PX = 4;

/**
 * First entry of every page: entries fill `available` CSS px (`gap` between them) in order; an
 * entry larger than the room gets a page of its own. No room (unmeasured) = one page.
 */
export function legendPages(sizes: number[], gap: number, available: number): number[] {
  const starts = [0];
  if (!(available > 0)) return starts;
  let used = 0;
  sizes.forEach((size, i) => {
    const next = used === 0 ? size : used + gap + size;
    if (used > 0 && next > available) {
      starts.push(i);
      used = size;
    } else {
      used = next;
    }
  });
  return starts;
}

/** Width of a left / right legend column: the longest name at ~6.5 px per character + swatch. */
export function legendColumnWidth(names: string[]): number {
  const longest = Math.max(0, ...names.map((n) => n.length));
  return Math.min(200, Math.max(72, longest * 6.5 + 30));
}

/** Container style of a legend at `position` (`pad` = plot padding, `titled` = a title row above). */
export function legendStyle(position: ChartLegendPosition, wrap: boolean, pad: { top: number; right: number; bottom: number; left: number }, titled: boolean, width: number): Partial<CSSStyleDeclaration> {
  const row = { display: 'flex', alignItems: 'center', flexWrap: wrap ? 'wrap' : 'nowrap', gap: `4px ${ROW_GAP_PX}px` };
  switch (position) {
    case 'bottom':
      return { ...row, left: `${pad.left}px`, right: `${pad.right}px`, bottom: '6px' };
    case 'left':
    case 'right':
      return {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: `${COLUMN_GAP_PX}px`,
        [position]: `${LEGEND_SIDE_GAP_PX}px`,
        top: `${pad.top}px`,
        width: `${width}px`,
      };
    default:
      return { ...row, left: `${pad.left}px`, right: `${pad.right}px`, top: `${titled ? 36 : 10}px` };
  }
}

/**
 * ‹ n / m › pager of a one-row / one-column legend: shows the entries of one page (the others
 * get `display: none`, so they neither take room nor focus nor paint in exports).
 */
export class LegendPager {
  readonly root: HTMLDivElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private starts = [0];
  private page = 0;
  private key = '';

  constructor(
    private readonly items: HTMLElement[],
    private readonly vertical: boolean,
    color: string
  ) {
    this.root = document.createElement('div');
    this.root.className = 'charturbo-sdk-legend-pager';
    Object.assign(this.root.style, {
      display: 'none',
      alignItems: 'center',
      gap: '4px',
      flex: 'none',
      marginLeft: vertical ? '0px' : 'auto',
      color,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    });
    const button = (text: string, label: string, step: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'charturbo-sdk-legend-page';
      b.textContent = text;
      b.setAttribute('aria-label', label);
      Object.assign(b.style, { border: 'none', background: 'none', font: 'inherit', color: 'inherit', padding: '0 4px', cursor: 'pointer' });
      b.addEventListener('click', () => this.show(this.page + step));
      return b;
    };
    this.prev = button('‹', 'Previous legend page', -1);
    this.next = button('›', 'Next legend page', 1);
    this.label = document.createElement('span');
    this.root.append(this.prev, this.label, this.next);
  }

  /** Re-pages for `room` CSS px along the legend (skipped when unchanged). */
  layout(room: number): void {
    const key = String(Math.round(room));
    if (key === this.key) return;
    this.key = key;
    // Measure every entry shown, then keep the page that holds the current first entry
    const first = this.starts[this.page] ?? 0;
    this.items.forEach((el) => (el.style.display = 'inline-flex'));
    const sizes = this.items.map((el) => (this.vertical ? el.offsetHeight : el.offsetWidth) || 0);
    const gap = this.vertical ? COLUMN_GAP_PX : ROW_GAP_PX;
    const pager = this.vertical ? PAGER_COLUMN_PX : PAGER_ROW_PX;
    const total = sizes.reduce((s, v) => s + v, 0) + gap * Math.max(0, sizes.length - 1);
    this.starts = total <= room ? [0] : legendPages(sizes, gap, room - pager);
    let page = 0;
    while (page + 1 < this.starts.length && this.starts[page + 1] <= first) page++;
    this.show(page);
  }

  show(page: number): void {
    const n = this.starts.length;
    this.page = Math.max(0, Math.min(n - 1, page));
    const [a, b] = [this.starts[this.page], this.starts[this.page + 1] ?? this.items.length];
    this.items.forEach((el, i) => (el.style.display = i >= a && i < b ? 'inline-flex' : 'none'));
    this.root.style.display = n > 1 ? 'flex' : 'none';
    this.label.textContent = `${this.page + 1} / ${n}`;
    for (const [btn, off] of [
      [this.prev, this.page === 0],
      [this.next, this.page === n - 1],
    ] as const) {
      btn.setAttribute('aria-disabled', String(off));
      btn.style.opacity = off ? '0.35' : '1';
    }
  }
}
