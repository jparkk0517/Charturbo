import { describe, expect, it } from 'vitest';
import { buildA11yModel } from '../sdk/chart-a11y';
import { createFormatter, formatNumber, resolveFormat, resolveFormatLive } from '../sdk/chart-format';

const f = (v: number, spec: string, locale = 'en-US') => formatNumber(v, spec, locale);
/** Intl may separate a currency / unit with (narrow) no-break spaces */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatNumber: d3-format style specs', () => {
  it('fixed point, grouping, integer', () => {
    expect(f(1234.567, '.2f')).toBe('1234.57');
    expect(f(1234567.8, ',.0f')).toBe('1,234,568');
    expect(f(1.5, '.3~f')).toBe('1.5');
    expect(f(3.7, 'd')).toBe('4');
    expect(f(12345, ',d')).toBe('12,345');
    expect(f(-0, '.2f')).toBe('0.00');
    expect(f(1 / 3, 'f')).toBe('0.333333'); // d3 default precision 6
  });

  it('percent and sign', () => {
    expect(f(0.1234, '.1%')).toBe('12.3%');
    expect(f(0.5, '.0%')).toBe('50%');
    expect(f(1.25, '+.1f')).toBe('+1.3');
    expect(f(-2, '+.1f')).toBe('-2.0');
    expect(f(0, '+.1f')).toBe('0.0');
    expect(f(0.042, '+.1%')).toBe('+4.2%');
  });

  it('SI prefixes carry on rounding and keep the sign', () => {
    expect(f(1500, '.2s')).toBe('1.5k');
    expect(f(1234567, '.2s')).toBe('1.2M');
    expect(f(0.0012, '.2s')).toBe('1.2m');
    expect(f(0.0000042, '.2s')).toBe('4.2µ');
    expect(f(999.9, '.2s')).toBe('1.0k');
    expect(f(-1500, '.2s')).toBe('-1.5k');
    expect(f(1500, '.3s')).toBe('1.50k');
    expect(f(1500, '.3~s')).toBe('1.5k');
    expect(f(42, '.2s')).toBe('42');
    expect(f(0, '.2s')).toBe('0.0');
  });

  it('exponent', () => {
    expect(f(12345, '.2e')).toBe('1.23e+4');
    expect(f(-0.00012, '.1e')).toBe('-1.2e-4');
    expect(f(1000, '.3~e')).toBe('1e+3');
  });

  it('currency via Intl (`$` + `currency` option)', () => {
    expect(f(1234.5, '$,.2f')).toBe('$1,234.50');
    expect(f(-3, '$.0f')).toBe('-$3');
    const eur = plain(formatNumber(1234.5, '$,.2f', 'de-DE', { currency: 'EUR' }));
    expect(eur).toBe('1.234,50 €');
    expect(plain(formatNumber(2_500_000, '$compact', 'en-US'))).toBe('$2.5M');
  });

  it('compact notation and bytes', () => {
    expect(f(1500, 'compact')).toBe('1.5K');
    expect(f(2_000_000, 'compact')).toBe('2M');
    expect(f(1234, '.2compact')).toBe('1.23K');
    expect(f(1536, 'bytes')).toBe('1.5 KB');
    expect(f(3 * 1024 ** 2, 'bytes')).toBe('3 MB');
    expect(f(512, 'bytes')).toBe('512 B');
    expect(f(1536, '.2bytes')).toBe('1.50 KB');
    expect(f(1023.99, 'bytes')).toBe('1 KB'); // rounding carries into the next unit
    expect(f(-2048, 'bytes')).toBe('-2 KB');
  });

  it('locale-aware separators', () => {
    expect(f(1234.5, ',.2f', 'de-DE')).toBe('1.234,50');
    expect(f(1500, '.2s', 'de-DE')).toBe('1,5k');
  });

  it('Intl.NumberFormatOptions objects', () => {
    expect(formatNumber(0.5, { style: 'percent', maximumFractionDigits: 0 }, 'en-US')).toBe('50%');
    expect(formatNumber(1234.5, { maximumFractionDigits: 0 }, 'en-US')).toBe('1,235');
  });

  it('values rounding to zero print unsigned', () => {
    expect(f(-0.4, '.0f')).toBe('0');
    expect(f(-0.0001, '.1f')).toBe('0.0');
    expect(f(-0.04, 'bytes')).toBe('0 B');
    expect(f(-0.6, '.0f')).toBe('-1');
  });

  it('non-finite values print as numbers', () => {
    expect(f(NaN, '.2s')).toBe('NaN');
    expect(f(Infinity, 'bytes')).toBe('Infinity');
    expect(f(NaN, '.1e')).toBe('NaN');
  });

  it('invalid specs throw a TypeError', () => {
    expect(() => createFormatter('abc')).toThrow(TypeError);
    expect(() => createFormatter('.2x')).toThrow('Invalid number format spec ".2x"');
    expect(() => createFormatter('$.2s')).toThrow(TypeError);
    expect(() => createFormatter('$.1%')).toThrow(TypeError);
  });
});

describe('createFormatter / resolveFormat', () => {
  it('compiles a spec once per locale / currency and passes functions through', () => {
    const a = createFormatter('.2f', 'en-US');
    expect(createFormatter('.2f', { locale: 'en-US' })).toBe(a);
    expect(createFormatter('.2f', 'de-DE')).not.toBe(a);
    const opts: Intl.NumberFormatOptions = { maximumFractionDigits: 1 };
    expect(createFormatter(opts, 'en-US')).toBe(createFormatter(opts, 'en-US'));
    const fn = (v: number) => `#${v}`;
    expect(createFormatter(fn)).toBe(fn);
    expect(a(2)).toBe('2.00');
  });

  it('resolveFormat keeps function arguments; resolveFormatLive follows the locale', () => {
    const withGranularity = (v: number, g?: string) => `${v}:${g}`;
    expect(resolveFormat(withGranularity)!(1, 'day')).toBe('1:day');
    expect(resolveFormat(undefined)).toBeUndefined();
    expect(resolveFormat('.1f', 'en-US')!(2)).toBe('2.0');

    let locale = 'en-US';
    const live = resolveFormatLive<(v: number) => string>(',.1f', () => locale)!;
    expect(live(1234.5)).toBe('1,234.5');
    locale = 'de-DE';
    expect(live(1234.5)).toBe('1.234,5');
    expect(() => resolveFormatLive('nope', () => locale)).toThrow(TypeError);
    expect(resolveFormatLive(withGranularity, () => locale)).toBe(withGranularity);
  });
});

describe('a11y model uses spec axis formats', () => {
  it('summary / focus values follow a y format spec (invalid specs fall back)', () => {
    const meta = { kind: 'line', names: ['Rev'], colors: [[1, 0, 0, 1]], values: [[1234.5, 10]], offsets: [0], xPrefix: 'T', visible: [true] };
    const pres = (format: unknown) => ({
      xAxis: {},
      yAxis: { format },
      legend: { show: false, toggle: false, emphasize: false },
      navigable: false,
      formatX: (v: number) => `T+${v}`,
      locale: 'en-US',
    });
    expect(buildA11yModel(meta, pres('$,.2f'))!.formatValue(1234.5)).toBe('$1,234.50');
    expect(buildA11yModel(meta, pres({ maximumFractionDigits: 0 }))!.formatValue(1234.5)).toBe('1,235');
    expect(buildA11yModel(meta, pres('nope'))!.formatValue(2)).toBe(buildA11yModel(meta, pres(undefined))!.formatValue(2));
  });
});
