// Dev server of the offline previs renderer (scripts/previs-render.mjs starts it programmatically).
// `charturbo` imports resolve to the sources like in the examples site.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const src = resolve(root, '../src');

export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: [{ find: /^charturbo$/, replacement: resolve(src, 'index.ts') }],
  },
  // wasm-pkg may be a symlink to another checkout: do not restrict file serving to the repo
  server: { fs: { strict: false } },
});
