/**
 * Site theme without the chart engine (the landing page imports this before the engine loads;
 * theme.ts adds the chart side). The initial value comes from the inline boot script that
 * examples/vite.config.ts puts in every page's <head> (rules: docs/.vitepress/theme/site-theme.ts).
 */
import { applyTheme, currentTheme, THEME_NAMES } from '../../../docs/.vitepress/theme/site-theme';
import { t } from './i18n';

/** `surface` = --ct-surface of the theme (docs/.vitepress/theme/tokens.css): charts blend with their cards. */
export const THEMES = {
  dark: { label: 'Dark', base: 'dark', surface: '#0d131e', floor: '#1c2535', obstacle: '#35435c' },
  light: { label: 'Light', base: 'light', surface: '#ffffff', floor: '#e0e6ef', obstacle: '#97a7bc' },
  midnight: { label: 'Midnight', base: 'dark', surface: '#101b35', floor: '#182b4c', obstacle: '#334f78' },
  paper: { label: 'Paper', base: 'light', surface: '#faf6ed', floor: '#e3dac8', obstacle: '#b1a38a' },
} as const;
export type ThemeName = keyof typeof THEMES;

let theme: ThemeName = currentTheme();
const listeners = new Set<() => void>();
export const getThemeName = () => theme;
export function setThemeName(next: ThemeName): void {
  theme = next;
  applyTheme(theme);
  for (const listener of listeners) listener();
}
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Localized theme name for controls (`THEMES[].label` stays the chart theme name). */
export const themeLabel = (name: ThemeName) => t(`theme.${name}`);
/** Theme select of the site header (same markup as the docs' SiteControls.vue). */
export function themeControl(): HTMLElement {
  const label = document.createElement('label');
  label.className = 'site-theme';
  const text = label.appendChild(document.createElement('span'));
  text.className = 'site-control-label';
  text.textContent = t('site.theme');
  const select = label.appendChild(document.createElement('select'));
  select.name = 'site-theme';
  select.title = t('site.theme');
  for (const value of THEME_NAMES) select.add(new Option(themeLabel(value), value));
  select.value = theme;
  select.addEventListener('change', () => setThemeName(select.value as ThemeName));
  subscribeTheme(() => { select.value = theme; });
  return label;
}
