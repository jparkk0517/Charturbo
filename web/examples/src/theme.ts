import { CHARTURBO_THEMES, type Charturbo, type CharturboThemeInput } from 'charturbo';
import { t } from './i18n';

export const THEMES = {
  dark: { label: 'Dark', base: 'dark', surface: '#090b14', floor: '#1c2535', obstacle: '#35435c' },
  light: { label: 'Light', base: 'light', surface: '#ffffff', floor: '#e0e6ef', obstacle: '#97a7bc' },
  midnight: { label: 'Midnight', base: 'dark', surface: '#101b35', floor: '#182b4c', obstacle: '#334f78' },
  paper: { label: 'Paper', base: 'light', surface: '#faf6ed', floor: '#e3dac8', obstacle: '#b1a38a' },
} as const;
export type ThemeName = keyof typeof THEMES;
const STORAGE_KEY = 'charturbo-examples-theme';
let theme: ThemeName = 'dark';
try {
  const saved = localStorage.getItem(STORAGE_KEY)
    ?? JSON.parse(localStorage.getItem('charturbo-examples-scene-design') ?? 'null')?.theme;
  if (typeof saved === 'string' && Object.hasOwn(THEMES, saved)) theme = saved as ThemeName;
} catch { /* Preferences also work without storage. */ }
const listeners = new Set<() => void>();
export const getThemeName = () => theme;
export function chartTheme(): CharturboThemeInput {
  const selected = THEMES[theme];
  return { ...CHARTURBO_THEMES[selected.base], name: selected.label, surface: selected.surface };
}
export function setThemeName(next: ThemeName): void {
  theme = next;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* In-memory fallback. */ }
  for (const listener of listeners) listener();
}
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function bindTheme(sdk: Charturbo): () => void {
  const refresh = () => { sdk.setTheme(chartTheme()); sdk.render(); };
  refresh();
  return subscribeTheme(refresh);
}
/** Localized theme name for controls (`THEMES[].label` stays the chart theme name). */
export const themeLabel = (name: ThemeName) => t(`theme.${name}`);
export function themeControl(): HTMLElement {
  document.documentElement.dataset.theme = theme;
  const label = document.createElement('label');
  label.className = 'site-theme';
  label.textContent = t('site.theme');
  const select = label.appendChild(document.createElement('select'));
  select.name = 'site-theme';
  for (const value of Object.keys(THEMES) as ThemeName[]) select.add(new Option(themeLabel(value), value));
  select.value = theme;
  select.addEventListener('change', () => setThemeName(select.value as ThemeName));
  subscribeTheme(() => { select.value = theme; });
  return label;
}
