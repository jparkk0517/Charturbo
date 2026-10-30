/**
 * Races and transition keys. The engine animates (chart/race.rs, chart/transition.rs); this module
 * resolves `realtimeSort`, orders race data, keeps stable mark keys (bar race / morph pairing by
 * name), computes count-up label values, and places line `endLabel` DOM labels at the engine's
 * line end anchors (which follow the left -> right reveal).
 */
import type { RgbaTuple } from './color';
import type { CharturboTheme, WasmCharturboEngineBackend } from './charturbo';

/** Bar race options (`realtimeSort`). */
export interface BarRealtimeSortOptions {
  /** Bars shown: the `max` largest values (default: all); bars entering / leaving fade */
  max?: number;
  /** Data labels count up from the previous value of their category (default: true) */
  valueAnimation?: boolean;
}

export interface ResolvedRealtimeSort {
  max: number;
  valueAnimation: boolean;
}

/** `realtimeSort` option (`null` = off). Throws on a bad value. */
export function resolveRealtimeSort(opt: boolean | BarRealtimeSortOptions | undefined): ResolvedRealtimeSort | null {
  if (opt === undefined || opt === false) return null;
  if (opt !== true && (typeof opt !== 'object' || opt === null)) {
    throw new Error(`realtimeSort: expected a boolean or { max, valueAnimation } (got ${String(opt)})`);
  }
  const o: BarRealtimeSortOptions = opt === true ? {} : opt;
  const max = o.max ?? Infinity;
  if (max !== Infinity && !(Number.isInteger(max) && max >= 1)) {
    throw new Error(`realtimeSort: max must be an integer >= 1 (got ${String(max)})`);
  }
  if (o.valueAnimation !== undefined && typeof o.valueAnimation !== 'boolean') {
    throw new Error(`realtimeSort: valueAnimation must be a boolean (got ${String(o.valueAnimation)})`);
  }
  return { max, valueAnimation: o.valueAnimation ?? true };
}

/** Items by value descending (stable; missing values last), the first `max` of them. */
export function raceOrder<T extends { value: number }>(items: readonly T[], max: number): T[] {
  const rank = (v: number) => (Number.isFinite(v) ? v : -Infinity);
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(b.item.value) - rank(a.item.value) || a.i - b.i)
    .slice(0, max)
    .map((e) => e.item);
}

/**
 * u32 key per name, stable from one `keysOf` call to the next (only consecutive charts pair, so
 * only the last call's names are kept); repeated names in one chart get their own key.
 */
export class MarkKeys {
  private last = new Map<string, number>();
  private next = 0;

  /** Names remembered from the last call. */
  get size(): number {
    return this.last.size;
  }

  keysOf(names: readonly string[]): Uint32Array {
    const seen = new Map<string, number>();
    const current = new Map<string, number>();
    const keys = Uint32Array.from(names, (name) => {
      const n = seen.get(name) ?? 0;
      seen.set(name, n + 1);
      const id = n === 0 ? name : `${name}\u0000${n}`;
      let k = current.get(id) ?? this.last.get(id);
      if (k === undefined) {
        k = this.next;
        this.next = (this.next + 1) % 0xffff_0000; // below the engine's reserved keys
      }
      current.set(id, k);
      return k;
    });
    this.last = current;
    return keys;
  }
}

/**
 * Name path of every hierarchy node (`parents[i]` = parent index, -1 = root) plus, for the extra
 * trailing name (the synthetic root above several roots), that name alone. Transition keys.
 */
export function hierarchyPaths(parents: ArrayLike<number>, names: readonly string[]): string[] {
  const n = parents.length;
  const paths: (string | undefined)[] = new Array(n);
  const path = (i: number): string => {
    // Iterative: deep trees must not overflow the stack
    const chain: number[] = [];
    let v = i;
    while (v >= 0 && v < n && paths[v] === undefined && chain.length <= n) {
      chain.push(v);
      v = parents[v];
    }
    let prefix = v >= 0 && v < n ? paths[v]! : '';
    for (let k = chain.length - 1; k >= 0; k--) {
      const u = chain[k];
      prefix = `${prefix}\u0001${names[u] ?? ''}`;
      paths[u] = prefix;
    }
    return paths[i]!;
  };
  const out = Array.from({ length: n }, (_, i) => path(i));
  for (let i = n; i < names.length; i++) out.push(`\u0002${names[i]}`);
  return out;
}

/** Decimal places of `v` as a float32 (0..6): integers count up as integers. */
function decimals(v: number): number {
  for (let d = 0; d < 6; d++) {
    const p = 10 ** d;
    if (Math.fround(Math.round(v * p) / p) === Math.fround(v)) return d;
  }
  return 6;
}

/**
 * Label values at eased progress `e`: from the previous value of each key (0 for new keys),
 * rounded to the decimals of the two endpoints (like ECharts `valueAnimation`).
 */
export function countUpValues(keys: Uint32Array, to: ArrayLike<number>, from: ReadonlyMap<number, number>, e: number): Float32Array {
  return Float32Array.from(keys, (k, i) => {
    const v = to[i];
    if (!Number.isFinite(v)) return NaN;
    const f = from.get(k);
    const a = f !== undefined && Number.isFinite(f) ? f : 0;
    const p = 10 ** Math.max(decimals(a), decimals(v));
    return Math.round((a + (v - a) * e) * p) / p;
  });
}

/** Line `endLabel` option. */
export interface LineEndLabelOptions {
  /** Label text (default: `seriesName value`, the value like the y axis) */
  format?: (value: number, seriesName: string) => string;
}

/** Gap between the line end and its label (CSS px). */
export const END_LABEL_GAP_PX = 6;

/**
 * Series name + value next to the end of each visible line (`chart_line_end_labels`:
 * `[count, (series, x, y, value) * count]`), re-placed every frame so it rides the reveal.
 */
export class LineEndLabelLayer {
  readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];

  constructor(
    parent: HTMLElement,
    private readonly names: readonly string[],
    private readonly colors: readonly RgbaTuple[],
    private readonly formatValue: (value: number) => string,
    private readonly format?: (value: number, seriesName: string) => string
  ) {
    this.root = document.createElement('div');
    this.root.className = 'charturbo-sdk-end-labels';
    Object.assign(this.root.style, { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible', pointerEvents: 'none' });
    parent.appendChild(this.root);
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme): void {
    const a = backend.chart_line_end_labels?.();
    const count = a && a.length > 0 ? Math.min(a[0], Math.floor((a.length - 1) / 4)) : 0;
    let used = 0;
    for (let k = 0; k < count; k++) {
      const [s, x, y, value] = [a![1 + k * 4], a![2 + k * 4], a![3 + k * 4], a![4 + k * 4]];
      const name = this.names[s];
      if (name === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      let el = this.labels[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'charturbo-sdk-end-label';
        Object.assign(el.style, {
          position: 'absolute',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          fontSize: '12px',
          fontWeight: '600',
          fontVariantNumeric: 'tabular-nums',
          transform: 'translate(0, -50%)',
        });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      used++;
      const c = this.colors[s];
      el.textContent = this.format ? this.format(value, name) : `${name} ${this.formatValue(value)}`;
      el.style.display = 'block';
      el.style.left = `${x + END_LABEL_GAP_PX}px`;
      el.style.top = `${y}px`;
      el.style.color = c ? `rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(', ')})` : theme.textPrimary;
    }
    for (let k = used; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}
