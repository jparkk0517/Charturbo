// Examples site (`npm run examples:dev` / `examples:build`): a multi-page Vite app, one page per
// chart family. `viz-engine-sdk` imports resolve to the sources (../src), so the demo code reads
// exactly like application code against the published package.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const src = resolve(root, '../src');
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));

export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: [
      { find: /^viz-engine-sdk\/react$/, replacement: resolve(src, 'react/index.ts') },
      { find: /^viz-engine-sdk\/vue$/, replacement: resolve(src, 'vue/index.ts') },
      { find: /^viz-engine-sdk$/, replacement: resolve(src, 'index.ts') },
    ],
  },
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  server: { port: 5310, fs: { allow: [resolve(root, '..')] } },
  preview: { port: 5311 },
  build: {
    outDir: resolve(root, '../examples-dist'),
    emptyOutDir: true,
    // The engine (.wasm, ~2.9 MB) is one asset; the demos are small chunks
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      input: Object.fromEntries(pages.map((p) => [p.replace(/\.html$/, ''), resolve(root, p)])),
    },
  },
});
