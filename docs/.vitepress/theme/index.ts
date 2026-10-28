// Default theme plus the site-wide pieces: brand colors shared with the examples site and the
// <SiteLink> nav item for pages that live outside the docs (examples, benchmarks).
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import SiteLink from './SiteLink.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('SiteLink', SiteLink);
  },
} satisfies Theme;
