<script setup lang="ts">
// Nav link to a page of the examples site. The docs are served under `<site>/docs/`, so the site
// root is the docs base without `docs/`; VitePress would prefix internal links with the docs base
// and route them in-app, hence a plain anchor with target="_self" (a full page load).
import { computed } from 'vue';
import { useData } from 'vitepress';

const props = defineProps<{ text: string; path: string; screenMenu?: boolean }>();
const { site, localeIndex } = useData();
const href = computed(() => {
  const [path, hash] = props.path.split('#');
  const lang = localeIndex.value === 'root' ? 'en' : localeIndex.value;
  return `${site.value.base.replace(/docs\/$/, '')}${path}?lang=${lang}${hash ? `#${hash}` : ''}`;
});
</script>

<template>
  <a :class="screenMenu ? 'SiteLink screen' : 'SiteLink bar'" :href="href" target="_self">{{ text }}</a>
</template>

<style scoped>
/* Same metrics as VPNavBarMenuLink / VPNavScreenMenuLink */
.SiteLink {
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  transition: color 0.25s;
}
.SiteLink:hover {
  color: var(--vp-c-brand-1);
}
.bar {
  display: flex;
  align-items: center;
  padding: 0 12px;
  line-height: var(--vp-nav-height);
}
.screen {
  display: block;
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 12px 0 11px;
  line-height: 24px;
}
</style>
