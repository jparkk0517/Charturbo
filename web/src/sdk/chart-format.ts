/**
 * Number formatting for axis tick labels and tooltip values: a d3-format style spec string, an
 * `Intl.NumberFormatOptions` object, or a function. Specs compile once to an `Intl.NumberFormat`
 * backed function (cached per spec / locale); formatting is DOM presentation only.
 *
 * Spec grammar: `[sign][$][,][.precision][~][type]`
 * - sign `+`: sign on positive and negative values (zero unsigned); `-` (default): negative only
 * - `$`: currency (`Intl` style `currency`, code from the `currency` option, default `'USD'`);
 *   with no type, `f`, `d`, or `compact`
 * - `,`: locale digit grouping (thousands separators)
 * - `.precision`: fraction digits (`f`, `%`, `e`, `compact`, `bytes`) / significant digits
 *   (`s`, no type)
 * - `~`: trim insignificant trailing zeros
 * - type: `f` fixed point, `d` integer (rounded), `%` percent (x 100), `e` exponent (`1.5e+3`),
 *   `s` SI prefix (`1.5k`, `2.0M`, `3µ`), `compact` (`Intl` compact notation: `1.5K`, `2M`),
 *   `bytes` (1024-based: `1.5 KB`, `3 MB`); none = locale default
 * Missing precision defaults to 6 like d3-format (`d`: 0; `compact`: `Intl` default; `bytes`: 1).
 * Examples: `'.2f'`, `',.0f'`, `'.1%'`, `'.2s'`, `'$,.2f'`, `'compact'`, `'bytes'`, `'+.1f'`.
 */

/** Spec string (see the module doc) or `Intl.NumberFormatOptions`. */
export type ChartFormatSpec = string | Intl.NumberFormatOptions;

/** Value format option: a spec, or a function returning the label. */
export type ChartValueFormat = ChartFormatSpec | ((value: number) => string);

export interface ChartFormatOptions {
  /** BCP 47 locale (default: the runtime locale) */
  locale?: string;
  /** ISO 4217 code used by `$` specs (default: `'USD'`) */
  currency?: string;
}

type NumberFormatter = (value: number) => string;

const SPEC_RE = /^([+-])?(\$)?(,)?(?:\.(\d+))?(~)?(f|d|%|e|s|compact|bytes)?$/;
const SI_PREFIXES = ['y', 'z', 'a', 'f', 'p', 'n', 'µ', 'm', '', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];

interface ParsedSpec {
  sign: boolean;
  currency: boolean;
  group: boolean;
  precision: number | undefined;
  trim: boolean;
  type: string;
}

function parseSpec(spec: string): ParsedSpec {
  const m = SPEC_RE.exec(spec.trim());
  if (!m) throw new TypeError(`Invalid number format spec "${spec}"`);
  const precision = m[4] !== undefined ? Math.min(20, Number(m[4])) : undefined;
  const type = m[6] ?? '';
  if (m[2] && !['', 'f', 'd', 'compact'].includes(type)) {
    throw new TypeError(`Invalid number format spec "${spec}": "$" needs no type, "f", "d", or "compact"`);
  }
  return { sign: m[1] === '+', currency: !!m[2], group: !!m[3], precision, trim: !!m[5], type };
}

/** `Intl` options of the spec types that map onto `Intl.NumberFormat` directly. */
function intlOptions(p: ParsedSpec, currency: string): Intl.NumberFormatOptions {
  const o: Intl.NumberFormatOptions = { useGrouping: p.group };
  // Values rounding to zero print unsigned ("0.0", not "-0.0")
  o.signDisplay = p.sign ? 'exceptZero' : ('negative' as Intl.NumberFormatOptions['signDisplay']);
  if (p.currency) {
    o.style = 'currency';
    o.currency = currency;
  }
  const fixed = (digits: number) => {
    o.minimumFractionDigits = p.trim ? 0 : digits;
    o.maximumFractionDigits = digits;
  };
  switch (p.type) {
    case 'f':
      fixed(p.precision ?? 6);
      break;
    case 'd':
      fixed(0);
      break;
    case '%':
      o.style = 'percent';
      fixed(p.precision ?? 6);
      break;
    case 'compact':
      o.notation = 'compact';
      if (p.precision !== undefined) fixed(p.precision);
      else if (p.currency) o.maximumFractionDigits = 1;
      break;
    default:
      if (p.precision !== undefined) o.maximumSignificantDigits = Math.max(1, p.precision);
  }
  return o;
}

/** Drops trailing fraction zeros of a plain `toExponential` / `toFixed` mantissa. */
const trimZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

function compileSpec(spec: string, locale: string | undefined, currency: string): NumberFormatter {
  const p = parseSpec(spec);
  const signOf = (v: number) => (v < 0 ? '-' : p.sign && v > 0 ? '+' : '');
  if (p.type === 'e') {
    const digits = p.precision ?? 6;
    return (v) => {
      if (!Number.isFinite(v)) return String(v);
      const [mant, exp] = Math.abs(v).toExponential(digits).split('e');
      return `${signOf(v)}${p.trim ? trimZeros(mant) : mant}e${exp}`;
    };
  }
  if (p.type === 's') {
    const digits = Math.max(1, p.precision ?? 6);
    const nf = new Intl.NumberFormat(locale, {
      useGrouping: p.group,
      minimumSignificantDigits: p.trim ? 1 : digits,
      maximumSignificantDigits: digits,
    });
    return (v) => {
      if (!Number.isFinite(v)) return String(v);
      const a = Math.abs(v);
      if (a === 0) return nf.format(0);
      let k = Math.max(-8, Math.min(8, Math.floor(Math.log10(a) / 3)));
      // Rounding to `digits` may carry into the next prefix (999.9 at 2 digits = 1.0k)
      const rounded = (x: number) => Number(x.toPrecision(digits));
      if (k < 8 && rounded(a / 10 ** (3 * k)) >= 1000) k++;
      return `${signOf(v)}${nf.format(a / 10 ** (3 * k))}${SI_PREFIXES[k + 8]}`;
    };
  }
  if (p.type === 'bytes') {
    const digits = p.precision ?? 1;
    const nf = new Intl.NumberFormat(locale, {
      useGrouping: p.group,
      minimumFractionDigits: p.trim || p.precision === undefined ? 0 : digits,
      maximumFractionDigits: digits,
    });
    return (v) => {
      if (!Number.isFinite(v)) return String(v);
      const a = Math.abs(v);
      let u = 0;
      while (u < BYTE_UNITS.length - 1 && Number((a / 1024 ** u).toFixed(digits)) >= 1024) u++;
      const m = a / 1024 ** u;
      return `${Number(m.toFixed(digits)) === 0 ? '' : signOf(v)}${nf.format(m)} ${BYTE_UNITS[u]}`;
    };
  }
  const nf = new Intl.NumberFormat(locale, intlOptions(p, currency));
  return (v) => nf.format(v);
}

const MAX_CACHED = 256;
const stringCache = new Map<string, NumberFormatter>();
const objectCache = new WeakMap<Intl.NumberFormatOptions, Map<string, NumberFormatter>>();

function resolveOptions(options: ChartFormatOptions | string | undefined): { locale?: string; currency: string } {
  const o = typeof options === 'string' ? { locale: options } : (options ?? {});
  return { locale: o.locale, currency: o.currency ?? 'USD' };
}

/**
 * Formatter function of `spec` (compiled once; specs are cached per locale / currency). A
 * function `spec` is returned as is. Invalid spec strings throw a `TypeError`.
 * `options`: locale string or `{ locale, currency }`.
 */
export function createFormatter(spec: ChartValueFormat, options?: ChartFormatOptions | string): (value: number) => string {
  if (typeof spec === 'function') return spec;
  const { locale, currency } = resolveOptions(options);
  const key = `${locale ?? ''}|${currency}`;
  if (typeof spec === 'string') {
    const k = `${key}|${spec}`;
    let f = stringCache.get(k);
    if (!f) {
      f = compileSpec(spec, locale, currency);
      if (stringCache.size >= MAX_CACHED) stringCache.clear();
      stringCache.set(k, f);
    }
    return f;
  }
  let byLocale = objectCache.get(spec);
  if (!byLocale) objectCache.set(spec, (byLocale = new Map()));
  let f = byLocale.get(key);
  if (!f) {
    const nf = new Intl.NumberFormat(locale, spec);
    f = (v: number) => nf.format(v);
    byLocale.set(key, f);
  }
  return f;
}

/** Formats `value` with a spec string / `Intl.NumberFormatOptions` (see the module doc). */
export function formatNumber(value: number, spec: ChartFormatSpec, locale?: string, options?: Pick<ChartFormatOptions, 'currency'>): string {
  return createFormatter(spec, { locale, currency: options?.currency })(value);
}

/**
 * SDK hook: the function form of an optional axis / tooltip `format` option (functions pass
 * through with their extra arguments, e.g. the time-tick granularity; specs ignore them).
 */
export function resolveFormat<F extends (value: number, ...rest: never[]) => string>(
  format: F | ChartFormatSpec | undefined,
  locale?: string
): F | undefined {
  if (format === undefined) return undefined;
  // A spec formatter ignores the extra arguments, so it stands in for `F`
  return typeof format === 'function' ? format : (createFormatter(format, locale) as unknown as F);
}

/**
 * `resolveFormat` for options kept past the render call: the returned function follows `locale`
 * (`setLocale`) through the formatter cache. Specs are validated now (invalid specs throw here).
 */
export function resolveFormatLive<F extends (value: number, ...rest: never[]) => string>(
  format: F | ChartFormatSpec | undefined,
  locale: () => string | undefined
): F | undefined {
  if (format === undefined || typeof format === 'function') return format;
  createFormatter(format, locale());
  return ((v: number) => createFormatter(format, locale())(v)) as unknown as F;
}
