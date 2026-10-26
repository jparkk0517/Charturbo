import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Pure SDK has zero external runtime dependencies (three.js is only used in the benchmark demo app).
// React / Vue are optional peers used only by the `./react` / `./vue` entries.
const external = ['three', 'react', 'react-dom', 'react/jsx-runtime', 'vue'];

const UMD_FILE = 'viz-engine-sdk.umd.cjs';
const WASM_FILE = 'viz_core_bg.wasm';
const WASM_PATH = resolve(import.meta.dirname, 'src/wasm-pkg', WASM_FILE);
const WASM_BASE64_ID = 'virtual:viz-wasm-base64';
/** wasm-bindgen's default module location in `wasm-pkg/viz_core.js` (`--target web`) */
const WASM_URL_RE = /new URL\('viz_core_bg\.wasm', import\.meta\.url\)/;
const WASM_URL_TOKEN = '__VIZ_WASM_DEFAULT_URL__';

/**
 * WASM packaging. Vite's lib mode always inlines `new URL('x', import.meta.url)` assets as
 * base64, so the wasm-bindgen URL is hidden from it (token) during the build and restored after:
 * - ES: `new URL('./viz_core_bg.wasm', import.meta.url)` + the binary emitted next to the chunk,
 *   which consumer bundlers (Vite, webpack 5, Rollup / Parcel asset plugins) pick up as an asset.
 * - UMD: no default URL; the entry is src/inline.ts, which embeds the module (`virtual:viz-wasm-base64`).
 */
function vizWasm(umd: boolean): Plugin {
  return {
    name: 'viz-wasm',
    enforce: 'pre',
    resolveId(id) {
      return id === WASM_BASE64_ID ? `\0${WASM_BASE64_ID}` : null;
    },
    load(id) {
      if (id !== `\0${WASM_BASE64_ID}`) return null;
      return `export default ${JSON.stringify(readFileSync(WASM_PATH).toString('base64'))};`;
    },
    transform(code, id) {
      if (!id.endsWith('/wasm-pkg/viz_core.js')) return null;
      if (!WASM_URL_RE.test(code)) this.error(`viz-wasm: wasm-bindgen URL pattern not found in ${id}`);
      return { code: code.replace(WASM_URL_RE, WASM_URL_TOKEN), map: null };
    },
    renderChunk(code) {
      if (!code.includes(WASM_URL_TOKEN)) return null;
      const url = umd
        ? `(() => { throw new Error('viz-engine-sdk: no WASM source (see setWasmSource)'); })()`
        : `new URL('./${WASM_FILE}', import.meta.url)`;
      return { code: code.replace(WASM_URL_TOKEN, url), map: null };
    },
    generateBundle() {
      if (!umd) this.emitFile({ type: 'asset', fileName: WASM_FILE, source: readFileSync(WASM_PATH) });
    },
  };
}

export default defineConfig(({ mode }) =>
  mode === 'umd'
    ? {
        // Second pass (`--mode umd`): the core UMD bundle (UMD has no multi-entry support), WASM embedded
        plugins: [vizWasm(true)],
        build: {
          outDir: 'dist-lib',
          emptyOutDir: false,
          lib: {
            entry: resolve(import.meta.dirname, 'src/inline.ts'),
            name: 'VizEngineSDK',
            fileName: () => UMD_FILE,
            formats: ['umd'],
          },
          rolldownOptions: { external },
        },
      }
    : {
        // ES entries: core (separate .wasm) + `/inline` (embedded .wasm) + framework wrappers; all share the core chunk
        plugins: [vizWasm(false)],
        build: {
          outDir: 'dist-lib',
          emptyOutDir: true,
          lib: {
            entry: {
              'viz-engine-sdk': resolve(import.meta.dirname, 'src/index.ts'),
              inline: resolve(import.meta.dirname, 'src/inline.ts'),
              react: resolve(import.meta.dirname, 'src/react/index.ts'),
              vue: resolve(import.meta.dirname, 'src/vue/index.ts'),
            },
            formats: ['es'],
            fileName: (_format, name) => `${name}.js`,
          },
          rolldownOptions: { external },
        },
      }
);
