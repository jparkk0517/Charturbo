/**
 * Site language (English, Korean, Simplified Chinese). Import this module first on every page:
 * evaluating it sets `<html lang>`, which the charting library reads as its default locale for
 * built-in chart text, so it must happen before any demo mounts.
 *
 * Order: `?lang=en|ko|zh` → localStorage `charturbo-lang` → `navigator.language` → English.
 * A `?lang=` value is also stored, so links to the other pages keep the language.
 */
import { MESSAGES, type MessageKey } from './messages';

export type Lang = 'en' | 'ko' | 'zh';
export const LANGS: readonly Lang[] = ['en', 'ko', 'zh'];
/** Native names: the switcher must be readable whatever the current language is. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', ko: '한국어', zh: '简体中文' };
const HTML_LANG: Record<Lang, string> = { en: 'en', ko: 'ko', zh: 'zh-CN' };
const STORAGE_KEY = 'charturbo-lang';

function parseLang(value: string | null | undefined): Lang | null {
  const v = value?.trim().toLowerCase() ?? '';
  if (v === 'en' || v.startsWith('en-')) return 'en';
  if (v === 'ko' || v.startsWith('ko-')) return 'ko';
  if (v === 'zh' || v.startsWith('zh-')) return 'zh';
  return null;
}

function readStored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function store(next: Lang): boolean {
  try { localStorage.setItem(STORAGE_KEY, next); return true; } catch { return false; }
}

function browserLang(): Lang {
  const v = (typeof navigator === 'undefined' ? '' : navigator.language ?? '').toLowerCase();
  return v.startsWith('ko') ? 'ko' : v.startsWith('zh') ? 'zh' : 'en';
}

const queryLang = parseLang(new URLSearchParams(location.search).get('lang'));
if (queryLang) store(queryLang);

/** Current site language (fixed for the page lifetime: `setLang` reloads). */
export const lang: Lang = queryLang ?? parseLang(readStored()) ?? browserLang();
/** BCP 47 tag written to `<html lang>` and passed as `locale` by site-owned charts. */
export const htmlLang = HTML_LANG[lang];
document.documentElement.lang = htmlLang;
// A page restored from the back-forward cache may predate a language switch on another page.
addEventListener('pageshow', (event) => {
  if (event.persisted && (queryLang ?? parseLang(readStored()) ?? browserLang()) !== lang) location.reload();
});

/** Translated UI string; `{name}` placeholders are replaced from `vars`. Falls back to English. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text: string = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}

/**
 * Docs-site URL (VitePress, served under `docs/` next to these pages) in the current language.
 * The API reference is English only.
 */
export const docsHref = (path: string) =>
  `./docs/${lang === 'en' || path.startsWith('api/') ? '' : `${lang}/`}${path}`;

/** Store the language and reload the page in it. */
export function setLang(next: Lang): void {
  if (next === lang) return;
  const url = new URL(location.href);
  // Without storage the choice travels in the URL instead.
  if (store(next)) url.searchParams.delete('lang');
  else url.searchParams.set('lang', next);
  if (url.href === location.href) location.reload();
  else location.replace(url.href);
}

/** Localized `<title>` and `<meta name="description">`. */
export function setPageMeta(title: string, description?: string): void {
  document.title = title;
  if (description === undefined) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.appendChild(meta);
  }
  meta.content = description;
}

/**
 * Translate static markup: `data-i18n="key"` (text), `data-i18n-html="key"` (trusted markup from
 * the dictionary) and `data-i18n-attr="attr:key; attr:key"`. The English markup stays as the
 * no-JS fallback; English pages are left untouched.
 */
export function applyTranslations(root: ParentNode = document): void {
  if (lang === 'en') return;
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MessageKey);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml as MessageKey);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key as MessageKey));
    }
  }
}

/** Language switcher: a native select (keyboard accessible) with a localized accessible name. */
export function languageControl(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'site-lang';
  const select = wrap.appendChild(document.createElement('select'));
  select.name = 'site-lang';
  select.setAttribute('aria-label', t('site.language'));
  select.title = t('site.language');
  for (const l of LANGS) {
    const option = new Option(LANG_NAMES[l], l);
    option.lang = HTML_LANG[l];
    select.add(option);
  }
  select.value = lang;
  select.addEventListener('change', () => setLang(select.value as Lang));
  return wrap;
}
