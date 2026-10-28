# Installation & Bundlers

Charturbo ships as an npm package (`charturbo`) with several entries. They differ in how the WebAssembly engine module (`charturbo_core_bg.wasm`, about 2.6 MB raw / 1.0 MB gzip / 0.77 MB brotli) reaches the browser. Pick the entry that matches your toolchain.

## Package status

::: warning
`charturbo` is not published to npm yet. `npm install charturbo` and CDN URLs work only after the first release. Until then, build the package from source.
:::

### Build from source {#build-from-source}

You need Node (`^22.12.0 || ^24.0.0 || >=26.0.0`), Rust and `wasm-pack`. Full instructions: [Development](../contributing/development).

```bash
# In a clone of https://github.com/jparkk0517/Charturbo
cd web
npm install
npm run wasm:build    # engine with WebGL2 fallback -> src/wasm-pkg
npm run wasm:webgpu   # WebGPU-only engine -> src/wasm-pkg-webgpu
npm pack              # builds dist-lib/ and writes charturbo-<version>.tgz

# In your app
npm install /path/to/charturbo-<version>.tgz
```

`npm pack` runs `build:lib` and `build:lib:webgpu` first, so both WebAssembly builds must exist. If you only need the default entries, `npm run build:lib` builds them into `web/dist-lib/`.

## Entries

| Entry | WebAssembly | Use with |
|---|---|---|
| `charturbo` | Separate file, loaded with `new URL('./charturbo_core_bg.wasm', import.meta.url)` | Vite, webpack 5, Rollup / Parcel with asset handling: the bundler emits the `.wasm` as an asset |
| `charturbo/inline` | Embedded as base64 (about 3.9 MB of JS) | esbuild or any setup without asset handling; no extra file to serve |
| `charturbo/umd` | Embedded | `<script>` tag (global `Charturbo`) and CommonJS `require` |
| `charturbo/react`, `charturbo/vue` | Shares the main entry | React >= 18 / Vue >= 3.3 (optional peer dependencies); ESM only |
| `charturbo/webgpu`, `charturbo/inline-webgpu`, `charturbo/webgpu-umd` | WebGPU-only engine | See [WebGPU-only build](#webgpu-only-build) |

All entries export the same API. Prefer `charturbo` when your bundler supports it: the binary `.wasm` is smaller than the base64 text and compiles while it downloads.

## Bundlers

### Vite

No configuration. `import { Charturbo } from 'charturbo'` works in dev and build; Vite emits `charturbo_core_bg.wasm` next to the chunk.

### webpack 5

No configuration. webpack 5 treats `new URL('...', import.meta.url)` as an asset reference and emits the `.wasm` file.

### esbuild

esbuild does not emit `new URL(..., import.meta.url)` assets. Use one of:

- `charturbo/inline` (nothing else to do), or
- `charturbo` plus a copy step that puts `charturbo_core_bg.wasm` on your server, and `setWasmSource` pointing at it:

```ts
import { setWasmSource, Charturbo } from 'charturbo';

setWasmSource('/assets/charturbo_core_bg.wasm');
const sdk = await Charturbo.create(canvas);
```

The file is exported as `charturbo/charturbo_core_bg.wasm`, so you can copy it from `node_modules/charturbo/dist-lib/charturbo_core_bg.wasm`.

### No bundler (`<script>` tag)

The UMD build embeds the module and exposes the global `Charturbo` (the namespace object; the class is `Charturbo.Charturbo`). Serve `dist-lib/charturbo.umd.cjs` from your own server:

```html
<canvas id="chart" style="width: 600px; height: 300px"></canvas>
<script src="/vendor/charturbo.umd.cjs"></script>
<script>
  Charturbo.Charturbo.create(document.querySelector('#chart')).then((sdk) => {
    sdk.renderLineChart([{ name: 'a', values: [1, 3, 2, 5] }]);
    sdk.render();
  });
</script>
```

### TypeScript

Types ship with the package. `moduleResolution` `bundler`, `node16` / `nodenext` (ESM and CJS) and `node10` are supported.

## Loading the module from another location

`setWasmSource(source)` overrides where the WebAssembly module comes from. Use it for a CDN, a copy step, or a strict Content Security Policy.

```ts
import { setWasmSource, Charturbo } from 'charturbo';
import wasmUrl from 'charturbo/charturbo_core_bg.wasm?url'; // Vite

setWasmSource(wasmUrl);
const sdk = await Charturbo.create(canvas);
```

| Accepted source | Notes |
|---|---|
| `string`, `URL`, `Request` | Fetched |
| `Response`, `Promise<Response>` | Single use: after a failed load, call `setWasmSource` again before retrying |
| `BufferSource` | The module bytes |
| `WebAssembly.Module` | An already compiled module |

- Call it before the first `Charturbo.create()` or `CharturboDevice.create()`. It is ignored once the module is loaded.
- The module is loaded once per page; concurrent `create()` calls share it. A failed load is retried on the next `create()`.
- `charturbo/inline` and the UMD build embed the module and need no source.

## Content Security Policy {#content-security-policy}

- Compiling WebAssembly needs `'wasm-unsafe-eval'` (or `'unsafe-eval'`) in `script-src`. This applies to every entry, including the inline and UMD builds.
- When the module is fetched (`charturbo`, or `setWasmSource` with a URL), its origin must be allowed by `connect-src`. The inline builds do not fetch it.
- The built-in tooltips are HTML strings with inline `style` attributes. A `style-src` without `'unsafe-inline'` blocks those attributes, and the tooltips lose their layout. The overlay labels are styled through the DOM style API and are not affected.

## WebGPU-only build {#webgpu-only-build}

`charturbo/webgpu` (ES, separate `charturbo_core_bg-webgpu.wasm`), `charturbo/inline-webgpu` (ES, embedded) and `charturbo/webgpu-umd` (UMD, embedded) contain an engine built without the WebGL2 fallback. The WebGL2 stack is more than half of the default module, so this build downloads much less. It exports the same API and types as `charturbo`.

On browsers without WebGPU, `Charturbo.create` from this build rejects with a `CharturboInitError`; it does not fall back. Choose the build at runtime if you need both:

```ts
// Without @webgpu/types, navigator.gpu is not in the DOM typings
const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
const adapter = await gpu?.requestAdapter().catch(() => null);
const { Charturbo } = adapter ? await import('charturbo/webgpu') : await import('charturbo');
const sdk = await Charturbo.create(canvas);
```

`charturbo/react` and `charturbo/vue` use the default build.

## Browser support

| Renderer | Browsers |
|---|---|
| WebGPU | Chrome / Edge 113+, Safari 26+ |
| WebGL2 (automatic fallback) | Other current browsers |

WebGPU is only exposed in secure contexts (HTTPS or `localhost`); on plain HTTP the default build uses WebGL2. `Charturbo.isSupported()` resolves `true` when either renderer is available.

## Server-side rendering

Importing any entry in Node or during SSR is safe: nothing touches `window` or `document` at import time, and `charturbo/inline` decodes its embedded module only on the first engine start. Create engines on the client only, for example in `useEffect` or `onMounted`. The React and Vue components already do this and render only `<div><canvas></div>` on the server.

## See also

- [Getting Started](./getting-started)
- [FAQ & Troubleshooting](./faq)
- [Development](../contributing/development)
