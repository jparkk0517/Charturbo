<script lang="ts">
import { ref as sharedRef } from 'vue';
import type { ThemeName as SharedThemeName } from './site-theme';
const sharedTheme = sharedRef<SharedThemeName>('dark');
</script>

<script setup lang="ts">
// Theme and language selects of the site header (web/examples/src/theme-state.ts, i18n.ts), so
// the docs and the examples share one control set. The theme drives VitePress's `isDark`.
import { onMounted, watch } from 'vue';
import { useData, useRouter, withBase } from 'vitepress';
import { applyTheme, currentTheme, THEME_BASE, THEME_NAMES, type ThemeName } from './site-theme';

defineProps<{ screen?: boolean }>();
type Lang = 'en' | 'ko' | 'zh';
const LANGS: Record<Lang, string> = { en: 'English', ko: '한국어', zh: '简体中文' };
const TEXT: Record<Lang, { theme: string; language: string } & Record<ThemeName, string>> = {
  en: { theme: 'Theme', language: 'Language', dark: 'Dark', light: 'Light', midnight: 'Midnight', paper: 'Paper' },
  ko: { theme: '테마', language: '언어', dark: '다크', light: '라이트', midnight: '미드나이트', paper: '페이퍼' },
  zh: { theme: '主题', language: '语言', dark: '深色', light: '浅色', midnight: '午夜', paper: '纸质' },
};

const { isDark, localeIndex, page } = useData();
const router = useRouter();
const lang = (): Lang => (localeIndex.value === 'root' ? 'en' : (localeIndex.value as Lang));
// SSR renders dark; the boot script's choice is read once mounted. One ref for both instances
// (nav bar and mobile screen), so a midnight / paper pick shows in the other one too.
const theme = sharedTheme;
onMounted(() => { theme.value = currentTheme(); });

function setTheme(next: ThemeName) {
  theme.value = next;
  applyTheme(next);
  isDark.value = THEME_BASE[next] === 'dark';
}
// Another control set (bar / mobile screen) or a VitePress shortcut changed light / dark
watch(isDark, (dark) => {
  const current = currentTheme();
  if ((THEME_BASE[current] === 'dark') !== dark) setTheme(dark ? 'dark' : 'light');
  else theme.value = current;
});

function setLang(next: Lang) {
  try { localStorage.setItem('charturbo-lang', next); } catch { /* The docs path carries the language. */ }
  const rest = page.value.relativePath.replace(/^(ko|zh)\//, '').replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
  router.go(withBase(`${next === 'en' ? '/' : `/${next}/`}${rest}`));
}
</script>

<template>
  <div :class="['site-controls', screen ? 'screen' : 'bar']">
    <label class="site-theme">
      <span class="site-control-label">{{ TEXT[lang()].theme }}</span>
      <select name="site-theme" :title="TEXT[lang()].theme" :value="theme" @change="setTheme(($event.target as HTMLSelectElement).value as ThemeName)">
        <option v-for="name in THEME_NAMES" :key="name" :value="name">{{ TEXT[lang()][name] }}</option>
      </select>
    </label>
    <div class="site-lang">
      <select name="site-lang" :aria-label="TEXT[lang()].language" :title="TEXT[lang()].language" :value="lang()" @change="setLang(($event.target as HTMLSelectElement).value as Lang)">
        <option v-for="(label, code) in LANGS" :key="code" :value="code" :lang="code === 'zh' ? 'zh-CN' : code">{{ label }}</option>
      </select>
    </div>
  </div>
</template>
