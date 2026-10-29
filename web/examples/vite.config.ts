// Examples site (`npm run examples:dev` / `examples:build`): a multi-page Vite app, one page per
// chart family. `charturbo` imports resolve to the sources (../src), so the demo code reads
// exactly like application code against the published package.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { THEME_BOOT_SCRIPT } from '../../docs/.vitepress/theme/site-theme.ts';

const root = import.meta.dirname;
const src = resolve(root, '../src');
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));

/** Every page: the site theme (data-theme) is set by an inline head script before first paint. */
const themeBoot: Plugin = {
  name: 'charturbo-theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: THEME_BOOT_SCRIPT, injectTo: 'head' }],
};

export default defineConfig({
  root,
  base: './',
  plugins: [themeBoot],
  resolve: {
    alias: [
      { find: /^charturbo\/react$/, replacement: resolve(src, 'react/index.ts') },
      { find: /^charturbo\/vue$/, replacement: resolve(src, 'vue/index.ts') },
      { find: /^charturbo$/, replacement: resolve(src, 'index.ts') },
    ],
  },
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  server: {
    port: 5310,
    fs: { allow: [resolve(root, '../..')] },
    // The docs live under docs/ of the same site; `npm run site:dev` starts their dev server
    proxy: { '/docs': { target: 'http://localhost:5320', ws: true } },
  },
  preview: { port: 5311 },
  build: {
    outDir: resolve(root, '../examples-dist'),
    emptyOutDir: true,
    // The engine (.wasm, ~2.6 MB) is one asset; the demos are small chunks
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      input: Object.fromEntries(pages.map((p) => [p.replace(/\.html$/, ''), resolve(root, p)])),
    },
  },
});
