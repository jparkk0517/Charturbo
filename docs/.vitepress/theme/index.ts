// Default theme plus the site-wide pieces: the design tokens shared with the examples site
// (style.css), the site's theme / language selects in the nav bar (SiteControls) and the
// <SiteLink> nav item for pages that live outside the docs (examples, benchmarks).
import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import SiteControls from './SiteControls.vue';
import SiteLink from './SiteLink.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'nav-bar-content-after': () => h(SiteControls),
    'nav-screen-content-after': () => h(SiteControls, { screen: true }),
  }),
  enhanceApp({ app }) {
    app.component('SiteLink', SiteLink);
  },
} satisfies Theme;
