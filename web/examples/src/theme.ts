import { CHARTURBO_THEMES, type Charturbo, type CharturboThemeInput } from 'charturbo';
import { getThemeName, subscribeTheme, THEMES } from './theme-state';

export * from './theme-state';

export function chartTheme(): CharturboThemeInput {
  const selected = THEMES[getThemeName()];
  return { ...CHARTURBO_THEMES[selected.base], name: selected.label, surface: selected.surface };
}
export function bindTheme(sdk: Charturbo): () => void {
  const refresh = () => { sdk.setTheme(chartTheme()); sdk.render(); };
  refresh();
  return subscribeTheme(refresh);
}
