import { afterEach, describe, expect, it } from 'vitest';
import { formatCount, formatNumber, getMessages, registerMessages, resolveLanguage, resolveLocale } from '../sdk/i18n';

describe('i18n: language resolution', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('maps locale tags to the built-in languages', () => {
    expect(resolveLanguage('ko')).toBe('ko');
    expect(resolveLanguage('ko-KR')).toBe('ko');
    expect(resolveLanguage('zh')).toBe('zh-CN');
    expect(resolveLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(resolveLanguage('zh-TW')).toBe('zh-CN');
    expect(resolveLanguage('en-GB')).toBe('en');
    expect(resolveLanguage('ja')).toBe('en');
    expect(resolveLanguage('kok')).toBe('en'); // Konkani is not Korean
  });

  it('defaults to the page language, then the browser language', () => {
    expect(resolveLocale()).toBe('en-US');
    (globalThis as { document?: unknown }).document = { documentElement: { lang: 'zh-CN' } };
    expect(resolveLocale()).toBe('zh-CN');
    expect(getMessages().common.total).toBe('合计');
    expect(resolveLocale('ko')).toBe('ko');
  });

  it('returns complete messages in every language', () => {
    expect(getMessages('en').common.total).toBe('Total');
    expect(getMessages('ko-KR').common.total).toBe('합계');
    expect(getMessages('zh-CN').common.seriesName(2)).toBe('系列 2');
    expect(getMessages('en').common.points(1, '1')).toBe('1 point');
    expect(getMessages('en').common.points(3, '3')).toBe('3 points');
  });
});

describe('i18n: Intl fallback', () => {
  it('formats numbers for message-only tags with the default locale', () => {
    registerMessages('x-mine', { common: { total: 'Mine' } });
    expect(getMessages('x-mine').common.total).toBe('Mine');
    expect(resolveLocale('x-mine')).toBe('en-US');
    expect(formatCount(1234, 'x-mine')).toBe('1,234');
    expect(formatNumber(1.234, 'de-DE')).toBe('1,23');
  });
});

describe('i18n: registerMessages', () => {
  it('overrides strings of a built-in language by subtag and full tag', () => {
    registerMessages('pt', { common: { total: 'Sum' } });
    registerMessages('pt-BR', { common: { value: 'Amount' } });
    const m = getMessages('pt-BR');
    expect(m.common.total).toBe('Sum');
    expect(m.common.value).toBe('Amount');
    expect(m.common.other).toBe('Other');
    expect(getMessages('pt').common.value).toBe('Value');
  });

  it('adds a language on top of English and merges repeated registrations', () => {
    registerMessages('ja', { common: { total: '合計' } });
    registerMessages('ja', { common: { value: '値' } });
    const m = getMessages('ja-JP');
    expect(m.common.total).toBe('合計');
    expect(m.common.value).toBe('値');
    expect(m.common.other).toBe('Other');
  });

  it('does not leak overrides into the built-in languages', () => {
    registerMessages('ko', { common: { total: '총계' } });
    expect(getMessages('ko').common.total).toBe('총계');
    expect(getMessages('en').common.total).toBe('Total');
    expect(getMessages('zh-CN').common.total).toBe('合计');
  });
});
