/**
 * Time zones of time axes. The engine has no tz database (wasm): this module derives a compact
 * UTC-offset transition table from `Intl.DateTimeFormat` for the data domain and the engine
 * aligns ticks to local boundaries with it (crates/charturbo-core/src/chart/time_zone.rs). Labels,
 * tooltips, a11y text, and CSV format with `Intl` in the same zone.
 */

/** `'UTC'`, the runtime's zone (`'local'`), or an IANA name such as `'America/New_York'`. */
export type CharturboTimeZone = 'UTC' | 'local' | (string & {});

/** Offset table for `set_chart_time_zone`, covering UTC ms `[lo, hi)`. */
export interface TimeZoneTable {
  /** UTC ms from which `offsets[i]` applies (the first entry covers earlier instants too) */
  transitions: Float64Array;
  /** Minutes east of UTC */
  offsets: Float32Array;
  lo: number;
  hi: number;
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** Years each table spans at most (longer domains keep the zone's later offsets) */
const MAX_YEARS = 400;
/** ECMAScript Date range: Intl throws outside it */
const MAX_DATE_MS = 8.64e15;

const formatters = new Map<string, Intl.DateTimeFormat>();
const yearCache = new Map<string, [number, number][]>();

/** Re-read the runtime zone at most this often (it is read on every chart frame) */
const RUNTIME_ZONE_TTL_MS = 10_000;
let runtimeZoneCache: { name: string | undefined; at: number } | null = null;

/** Runtime zone name (`'local'` resolves to it; `undefined` when Intl does not report one). */
function runtimeZone(): string | undefined {
  const now = Date.now();
  if (runtimeZoneCache && now - runtimeZoneCache.at < RUNTIME_ZONE_TTL_MS) return runtimeZoneCache.name;
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    name = undefined;
  }
  runtimeZoneCache = { name, at: now };
  return name;
}

/** Cache / comparison key of `tz`: `'local'` follows the runtime zone. */
export function timeZoneKey(tz: CharturboTimeZone): string {
  return tz === 'local' ? `local:${runtimeZone() ?? ''}` : tz;
}

/** True for UTC and its aliases (no offsets, the engine's zero-cost path). */
export function isUtcZone(tz: CharturboTimeZone): boolean {
  return tz === 'UTC' || tz === 'Etc/UTC' || tz === 'Etc/GMT' || tz === 'GMT';
}

/** `timeZone` for `Intl.DateTimeFormat` (`undefined` = the runtime zone). */
export function intlTimeZone(tz: CharturboTimeZone): string | undefined {
  return tz === 'local' ? undefined : tz;
}

/** Throws a `RangeError` naming `tz` unless the runtime knows it. */
export function validateTimeZone(tz: CharturboTimeZone): void {
  if (tz === 'local' || tz === 'UTC') return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new RangeError(`Unknown time zone '${tz}' (use 'UTC', 'local', or an IANA name like 'Europe/Berlin')`);
  }
}

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** UTC offset of `tz` at instant `ms`, in minutes east of UTC (whole seconds). */
export function timeZoneOffset(tz: CharturboTimeZone, ms: number): number {
  if (isUtcZone(tz) || !(Math.abs(ms) <= MAX_DATE_MS)) return 0;
  if (tz === 'local') return -new Date(ms).getTimezoneOffset();
  const p: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(ms)) p[part.type] = part.value;
  let year = Number(p.year);
  if (p.era === 'BC' || p.era === 'B') year = 1 - year;
  // setUTCFullYear keeps years 0..99 literal (Date.UTC maps them to 19xx)
  const wall = new Date(0);
  wall.setUTCFullYear(year, Number(p.month) - 1, Number(p.day));
  wall.setUTCHours(Number(p.hour) % 24, Number(p.minute), Number(p.second), 0);
  return (wall.getTime() - Math.floor(ms / 1000) * 1000) / 60_000;
}

/** First second in `(a, b]` whose offset differs from `a`'s (`a` / `b` differ). */
function findTransition(tz: CharturboTimeZone, a: number, b: number, offA: number): number {
  let lo = Math.floor(a / 1000);
  let hi = Math.ceil(b / 1000);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (timeZoneOffset(tz, mid * 1000) === offA) lo = mid;
    else hi = mid;
  }
  return hi * 1000;
}

/**
 * `[[utcMs, offsetMin], ...]` of UTC year `year`: its start offset, then every transition in the
 * year. Sampled weekly with a binary search per change, so two transitions less than a week
 * apart that cancel out are not seen (no current zone does that).
 */
function yearTransitions(tz: CharturboTimeZone, year: number): [number, number][] {
  const key = `${timeZoneKey(tz)}|${year}`;
  const hit = yearCache.get(key);
  if (hit) return hit;
  const start = new Date(0).setUTCFullYear(year, 0, 1);
  const end = new Date(0).setUTCFullYear(year + 1, 0, 1);
  const out: [number, number][] = [[start, timeZoneOffset(tz, start)]];
  let t = start;
  let off = out[0][1];
  while (t < end) {
    const next = Math.min(t + WEEK, end);
    const o = timeZoneOffset(tz, next);
    if (o !== off) {
      // Walk every change inside the week (a rare double change needs both)
      let a = t;
      let offA = off;
      while (offA !== o) {
        const at = findTransition(tz, a, next, offA);
        if (at >= end) break;
        offA = timeZoneOffset(tz, at);
        out.push([at, offA]);
        a = at;
      }
    }
    t = next;
    off = o;
  }
  yearCache.set(key, out);
  return out;
}

const utcYear = (ms: number) => new Date(Math.min(MAX_DATE_MS, Math.max(-MAX_DATE_MS, ms))).getUTCFullYear();

/**
 * Offset table of `tz` covering `[lo, hi]` (UTC ms) plus a year either side, from per-year
 * tables cached by zone. UTC (and unusable ranges) give empty arrays covering everything.
 */
export function buildTimeZoneTable(tz: CharturboTimeZone, lo: number, hi: number): TimeZoneTable {
  if (isUtcZone(tz) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { transitions: new Float64Array(0), offsets: new Float32Array(0), lo: -Infinity, hi: Infinity };
  }
  const y0 = utcYear(Math.min(lo, hi)) - 1;
  const y1 = Math.min(utcYear(Math.max(lo, hi)) + 1, y0 + MAX_YEARS - 1);
  const rows: [number, number][] = [];
  for (let y = y0; y <= y1; y++) {
    for (const row of yearTransitions(tz, y)) {
      // Year starts repeat the running offset: keep only real changes
      if (rows.length === 0 || rows[rows.length - 1][1] !== row[1]) rows.push(row);
    }
  }
  return {
    transitions: Float64Array.from(rows, (r) => r[0]),
    offsets: Float32Array.from(rows, (r) => r[1]),
    lo: new Date(0).setUTCFullYear(y0, 0, 1),
    hi: new Date(0).setUTCFullYear(y1 + 1, 0, 1),
  };
}

/** True when epoch ms `ms` is local midnight in `tz`. */
export function isLocalMidnight(tz: CharturboTimeZone, ms: number): boolean {
  const wall = ms + timeZoneOffset(tz, ms) * 60_000;
  return ((wall % DAY) + DAY) % DAY === 0;
}
