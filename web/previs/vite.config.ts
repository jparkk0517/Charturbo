// Dev server of the offline previs renderer (scripts/previs-render.mjs starts it programmatically).
// `charturbo` imports resolve to the sources like in the examples site.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const src = resolve(root, '../src');

export default defineConfig({
  // root = web/previs: the viewer (viewer.html) fetches examples/**/*.json and their models from here as static files
  root,
  base: './',
  resolve: {
    alias: [{ find: /^charturbo$/, replacement: resolve(src, 'index.ts') }],
  },
  // draco3d's decoder is a CommonJS file: pre-bundle it so `import()` gets its module.exports (see decoders.ts)
  optimizeDeps: { include: ['draco3d/draco_decoder_nodejs.js'] },
  // wasm-pkg may be a symlink to another checkout: do not restrict file serving to the repo
  server: { fs: { strict: false } },
});
