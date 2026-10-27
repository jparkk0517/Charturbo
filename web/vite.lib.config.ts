import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Pure SDK has zero external runtime dependencies (three.js is only used in the benchmark demo app).
// React / Vue are optional peers used only by the `./react` / `./vue` entries.
const external = ['three', 'react', 'react-dom', 'react/jsx-runtime', 'vue'];

const UMD_FILE = 'charturbo.umd.cjs';
const WASM_FILE = 'charturbo_core_bg.wasm';
// WebGPU-only build (`--no-default-features`): smaller wasm without the WebGL2 fallback stack.
// Built with `npm run wasm:webgpu` into src/wasm-pkg-webgpu; emitted as charturbo_core_bg-webgpu.wasm.
const WASM_FILE_WEBGPU = 'charturbo_core_bg-webgpu.wasm';
const WASM_PATH = resolve(import.meta.dirname, 'src/wasm-pkg', WASM_FILE);
const WASM_PATH_WEBGPU = resolve(import.meta.dirname, 'src/wasm-pkg-webgpu', WASM_FILE);
const WASM_BASE64_ID = 'virtual:charturbo-wasm-base64';
/** wasm-bindgen's default module location in `wasm-pkg/charturbo_core.js` (`--target web`) */
const WASM_URL_RE = /new URL\('charturbo_core_bg\.wasm', import\.meta\.url\)/;
const WASM_URL_TOKEN = '__CHARTURBO_WASM_DEFAULT_URL__';

/**
 * WASM packaging. Vite's lib mode always inlines `new URL('x', import.meta.url)` assets as
 * base64, so the wasm-bindgen URL is hidden from it (token) during the build and restored after:
 * - ES: `new URL('./charturbo_core_bg.wasm', import.meta.url)` + the binary emitted next to the chunk,
 *   which consumer bundlers (Vite, webpack 5, Rollup / Parcel asset plugins) pick up as an asset.
 * - UMD: no default URL; the entry is src/inline.ts, which embeds the module (`virtual:charturbo-wasm-base64`).
 *
 * The `webgpu` / `webgpu-umd` modes do the same for the WebGPU-only wasm (src/wasm-pkg-webgpu),
 * emitting it as charturbo_core_bg-webgpu.wasm so both builds can coexist in dist-lib.
 */
function charturboWasm(umd: boolean, webgpuOnly = false): Plugin {
  const wasmPath = webgpuOnly ? WASM_PATH_WEBGPU : WASM_PATH;
  const wasmFile = webgpuOnly ? WASM_FILE_WEBGPU : WASM_FILE;
  // The wasm-pkg-webgpu directory also uses charturbo_core.js (same wasm-bindgen glue file name).
  const wasmJsSuffix = webgpuOnly ? '/wasm-pkg-webgpu/charturbo_core.js' : '/wasm-pkg/charturbo_core.js';
  return {
    name: 'charturbo-wasm',
    enforce: 'pre',
    resolveId(id) {
      return id === WASM_BASE64_ID ? `\0${WASM_BASE64_ID}` : null;
    },
    load(id) {
      if (id !== `\0${WASM_BASE64_ID}`) return null;
      return `export default ${JSON.stringify(readFileSync(wasmPath).toString('base64'))};`;
    },
    transform(code, id) {
      if (!id.endsWith(wasmJsSuffix)) return null;
      if (!WASM_URL_RE.test(code)) this.error(`charturbo-wasm: wasm-bindgen URL pattern not found in ${id}`);
      return { code: code.replace(WASM_URL_RE, WASM_URL_TOKEN), map: null };
    },
    renderChunk(code) {
      if (!code.includes(WASM_URL_TOKEN)) return null;
      const url = umd
        ? `(() => { throw new Error('charturbo: no WASM source (see setWasmSource)'); })()`
        : `new URL('./${wasmFile}', import.meta.url)`;
      return { code: code.replace(WASM_URL_TOKEN, url), map: null };
    },
    generateBundle() {
      if (!umd) this.emitFile({ type: 'asset', fileName: wasmFile, source: readFileSync(wasmPath) });
    },
  };
}

/** WebGPU-only passes: every `…/wasm-pkg/charturbo_core(.js)` import resolves into src/wasm-pkg-webgpu. */
function webgpuPkgRedirect(): Plugin {
  const WASM_JS_RE = /[\\/]wasm-pkg[\\/]charturbo_core(\.js)?$/;
  return {
    name: 'charturbo-wasm-webgpu-redirect',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!WASM_JS_RE.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      return resolved.id.replace(/([\\/])wasm-pkg([\\/])/, '$1wasm-pkg-webgpu$2');
    },
  };
}

export default defineConfig(({ mode }) => {
  // WebGPU-only build: same structure as the full build but sourced from wasm-pkg-webgpu.
  // Produces dist-lib/charturbo-webgpu.js + charturbo_core_bg-webgpu.wasm (ES) and
  // dist-lib/charturbo-webgpu.umd.cjs (UMD, wasm embedded) for differential loading.
  if (mode === 'webgpu-umd') {
    return {
      plugins: [webgpuPkgRedirect(), charturboWasm(true, true)],
      build: {
        outDir: 'dist-lib',
        emptyOutDir: false,
        lib: {
          entry: resolve(import.meta.dirname, 'src/inline.ts'),
          name: 'Charturbo',
          fileName: () => 'charturbo-webgpu.umd.cjs',
          formats: ['umd'],
        },
        rolldownOptions: { external },
      },
    };
  }
  if (mode === 'webgpu') {
    return {
      plugins: [webgpuPkgRedirect(), charturboWasm(false, true)],
      build: {
        outDir: 'dist-lib',
        emptyOutDir: false,
        lib: {
          entry: {
            'charturbo-webgpu': resolve(import.meta.dirname, 'src/index.ts'),
            'inline-webgpu': resolve(import.meta.dirname, 'src/inline.ts'),
          },
          formats: ['es'],
          fileName: (_format, name) => `${name}.js`,
        },
        rolldownOptions: { external },
      },
    };
  }
  if (mode === 'umd') {
    return {
      // Second pass (`--mode umd`): the core UMD bundle (UMD has no multi-entry support), WASM embedded
      plugins: [charturboWasm(true)],
      build: {
        outDir: 'dist-lib',
        emptyOutDir: false,
        lib: {
          entry: resolve(import.meta.dirname, 'src/inline.ts'),
          name: 'Charturbo',
          fileName: () => UMD_FILE,
          formats: ['umd'],
        },
        rolldownOptions: { external },
      },
    };
  }
  return {
    // ES entries: core (separate .wasm) + `/inline` (embedded .wasm) + framework wrappers; all share the core chunk
    plugins: [charturboWasm(false)],
    build: {
      outDir: 'dist-lib',
      emptyOutDir: true,
      lib: {
        entry: {
          'charturbo': resolve(import.meta.dirname, 'src/index.ts'),
          inline: resolve(import.meta.dirname, 'src/inline.ts'),
          react: resolve(import.meta.dirname, 'src/react/index.ts'),
          vue: resolve(import.meta.dirname, 'src/vue/index.ts'),
        },
        formats: ['es'],
        fileName: (_format, name) => `${name}.js`,
      },
      rolldownOptions: { external },
    },
  };
});
