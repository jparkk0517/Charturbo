/**
 * Built-in UI text (accessibility summaries, data tables, default tooltips, chart labels) in
 * English, Korean and Simplified Chinese. The language follows the chart / SDK locale
 * (`create({ locale })`, `setLocale`, per-chart `locale`); when no locale is set it follows the
 * page language (`<html lang>`), then the browser language. Other languages fall back to
 * English. `registerMessages` overrides any string or adds a language. DOM-free apart from the
 * `<html lang>` / `navigator.language` lookup of the default.
 */
import { A11Y_MESSAGES } from './messages/a11y';
import { BOX_MESSAGES } from './messages/box';
import { BUSINESS_MESSAGES } from './messages/business';
import { COMBO_MESSAGES } from './messages/combo';
import { COMMON_MESSAGES } from './messages/common';
import { CORE_MESSAGES } from './messages/core';
import { HIERARCHY_MESSAGES } from './messages/hierarchy';
import { SPARKLINE_MESSAGES } from './messages/sparkline';

/** Languages with built-in messages. */
export type CharturboLanguage = 'en' | 'ko' | 'zh-CN';

export const CHARTURBO_LANGUAGES: readonly CharturboLanguage[] = ['en', 'ko', 'zh-CN'];

/** Every built-in string, grouped by the module that shows it. */
export interface CharturboMessages {
  common: (typeof COMMON_MESSAGES)['en'];
  a11y: (typeof A11Y_MESSAGES)['en'];
  core: (typeof CORE_MESSAGES)['en'];
  box: (typeof BOX_MESSAGES)['en'];
  combo: (typeof COMBO_MESSAGES)['en'];
  business: (typeof BUSINESS_MESSAGES)['en'];
  hierarchy: (typeof HIERARCHY_MESSAGES)['en'];
  sparkline: (typeof SPARKLINE_MESSAGES)['en'];
}

/** Partial messages for `registerMessages`: any subset of groups and keys. */
export type CharturboMessagesInput = { [G in keyof CharturboMessages]?: Partial<CharturboMessages[G]> };

const builtIn = (lang: CharturboLanguage): CharturboMessages => ({
  common: COMMON_MESSAGES[lang],
  a11y: A11Y_MESSAGES[lang],
  core: CORE_MESSAGES[lang],
  box: BOX_MESSAGES[lang],
  combo: COMBO_MESSAGES[lang],
  business: BUSINESS_MESSAGES[lang],
  hierarchy: HIERARCHY_MESSAGES[lang],
  sparkline: SPARKLINE_MESSAGES[lang],
});

const BUILT_IN: Record<CharturboLanguage, CharturboMessages> = {
  en: builtIn('en'),
  ko: builtIn('ko'),
  'zh-CN': builtIn('zh-CN'),
};

/** `registerMessages` overrides by lower-case locale tag */
const overrides = new Map<string, CharturboMessagesInput>();
/** Merged messages by lower-case effective locale (cleared by `registerMessages`) */
const cache = new Map<string, CharturboMessages>();

/** Page language, else browser language, else English. */
function defaultLocale(): string {
  const page = typeof document !== 'undefined' ? document.documentElement?.lang : '';
  if (page) return page;
  const browser = typeof navigator !== 'undefined' ? navigator.language : '';
  return browser || 'en';
}

/** Validity of tags for `Intl` (a tag registered for messages only, e.g. `x-mine`, is not) */
const intlTags = new Map<string, boolean>();

function isIntlTag(tag: string): boolean {
  let ok = intlTags.get(tag);
  if (ok === undefined) {
    try {
      ok = Intl.getCanonicalLocales(tag).length > 0;
    } catch {
      ok = false;
    }
    intlTags.set(tag, ok);
  }
  return ok;
}

/**
 * Locale tag for `Intl` number / date text: `locale`, else the page / browser language. A tag
 * `Intl` rejects falls back to the page / browser language, then English.
 */
export function resolveLocale(locale?: string): string {
  const tag = locale || defaultLocale();
  if (isIntlTag(tag)) return tag;
  const fallback = defaultLocale();
  return isIntlTag(fallback) ? fallback : 'en';
}

/** Built-in language of a locale tag: `ko*` → Korean, `zh*` → Simplified Chinese, else English. */
export function resolveLanguage(locale?: string): CharturboLanguage {
  const tag = (locale || defaultLocale()).toLowerCase();
  if (tag === 'ko' || tag.startsWith('ko-')) return 'ko';
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
  return 'en';
}

function merge(base: CharturboMessages, extra: CharturboMessagesInput | undefined): CharturboMessages {
  if (!extra) return base;
  const out = { ...base } as Record<string, object>;
  for (const [group, values] of Object.entries(extra)) {
    if (values && group in out) out[group] = { ...out[group], ...values };
  }
  return out as unknown as CharturboMessages;
}

/**
 * Messages for a locale: the built-in language, then overrides registered for the language
 * subtag (`ko`), then for the full tag (`ko-KR`).
 */
export function getMessages(locale?: string): CharturboMessages {
  const tag = (locale || defaultLocale()).toLowerCase();
  let m = cache.get(tag);
  if (!m) {
    const primary = tag.split('-')[0];
    m = merge(BUILT_IN[resolveLanguage(tag)], overrides.get(primary));
    if (primary !== tag) m = merge(m, overrides.get(tag));
    cache.set(tag, m);
  }
  return m;
}

/**
 * Override built-in strings or add a language. `locale` is a language (`'ja'`) or a full tag
 * (`'zh-TW'`); strings not given keep the built-in language of that locale (English for
 * languages without built-in messages). Applies to charts rendered or refreshed afterwards.
 *
 * ```ts
 * registerMessages('ko', { common: { total: '총계' } });
 * registerMessages('ja', { common: { total: '合計', value: '値' } });
 * ```
 */
export function registerMessages(locale: string, messages: CharturboMessagesInput): void {
  const tag = locale.toLowerCase();
  const prev = overrides.get(tag) ?? {};
  const next: CharturboMessagesInput = { ...prev };
  for (const [group, values] of Object.entries(messages) as [keyof CharturboMessages, object][]) {
    next[group] = { ...prev[group], ...values } as never;
  }
  overrides.set(tag, next);
  cache.clear();
}

/** Integer / count text in the locale (`1,234`, `1.234`, ...). */
export function formatCount(n: number, locale?: string): string {
  return n.toLocaleString(resolveLocale(locale));
}

/** Number text in the locale with up to `digits` fraction digits. */
export function formatNumber(v: number, locale?: string, digits = 2): string {
  return v.toLocaleString(resolveLocale(locale), { maximumFractionDigits: digits });
}
