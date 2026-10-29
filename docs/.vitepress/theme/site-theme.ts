/**
 * Site theme shared by the examples site (web/examples/src/theme-state.ts) and these docs
 * (SiteControls.vue): one `<html data-theme>` value, two storage keys.
 *
 * - `charturbo-examples-theme`: dark | light | midnight | paper (the site's own choice)
 * - `vitepress-theme-appearance`: dark | light | auto (VitePress's key, read by its own script)
 *
 * Both keys are written together, so a light/dark in the VitePress key that differs from the
 * site theme's base means it was changed on the docs side since; it wins. Nothing stored: the
 * OS `prefers-color-scheme`.
 */
export const THEME_BASE = { dark: 'dark', light: 'light', midnight: 'dark', paper: 'light' } as const;
export type ThemeName = keyof typeof THEME_BASE;
export const THEME_NAMES = Object.keys(THEME_BASE) as ThemeName[];
export const THEME_KEY = 'charturbo-examples-theme';
export const APPEARANCE_KEY = 'vitepress-theme-appearance';

export const isThemeName = (value: unknown): value is ThemeName =>
  typeof value === 'string' && Object.hasOwn(THEME_BASE, value);

/**
 * Inline `<script>` for `<head>` (examples: examples/vite.config.ts, docs: config.mts): sets
 * `data-theme`, the `dark` class and `color-scheme` before first paint. Plain ES5, no imports;
 * keep the rules in sync with the comment above. The legacy scene-design key held the theme
 * before `charturbo-examples-theme` existed.
 */
export const THEME_BOOT_SCRIPT = `(function () {
  var base = { dark: 'dark', light: 'light', midnight: 'dark', paper: 'light' };
  var root = document.documentElement, theme = null, docs = null;
  try {
    docs = localStorage.getItem('${APPEARANCE_KEY}');
    theme = localStorage.getItem('${THEME_KEY}');
  } catch (e) {}
  if (!theme) try { var scene = JSON.parse(localStorage.getItem('charturbo-examples-scene-design') || 'null'); theme = scene && scene.theme; } catch (e) {}
  if (!Object.prototype.hasOwnProperty.call(base, theme)) theme = null;
  var stored = theme;
  var os = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  var mode = docs === 'auto' ? os : docs;
  if (mode === 'dark' || mode === 'light') { if (!theme || base[theme] !== mode) theme = mode; }
  else if (!theme) theme = os;
  root.dataset.theme = theme;
  root.classList.toggle('dark', base[theme] === 'dark');
  root.style.colorScheme = base[theme];
  // A stored site theme without VitePress's key: store its base so VitePress agrees with it
  if (stored && !docs) try { localStorage.setItem('${APPEARANCE_KEY}', base[theme]); } catch (e) {}
})();`;

/** Theme the boot script chose (dark when it did not run, e.g. without JavaScript). */
export function currentTheme(): ThemeName {
  const value = typeof document === 'undefined' ? null : document.documentElement.dataset.theme;
  return isThemeName(value) ? value : 'dark';
}

/** Apply `name` to the page and remember it for every page of the site (docs included). */
export function applyTheme(name: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = name;
  root.classList.toggle('dark', THEME_BASE[name] === 'dark');
  root.style.colorScheme = THEME_BASE[name];
  try {
    localStorage.setItem(THEME_KEY, name);
    localStorage.setItem(APPEARANCE_KEY, THEME_BASE[name]);
  } catch { /* In-memory only without storage. */ }
}
