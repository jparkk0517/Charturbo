# Development

How to build Charturbo from source, produce the library package, the API docs, the examples site and the documentation site, and run the GPU visual regression tests.

## 1. Compile the Rust WASM package
```bash
wasm-pack build crates/charturbo-core --target web --out-dir ../../web/src/wasm-pkg
```

## 2. Build the plain NPM library (`dist-lib/`)
Packages only the SDK bundle and the `.d.ts` type definitions into `web/dist-lib/`, with the example showcase and benchmark UI fully excluded.
Output:
- `charturbo.js` (ES) + `charturbo_core_bg.wasm` (a separate file, loaded with `new URL('./charturbo_core_bg.wasm', import.meta.url)` → handled as an asset by Vite · webpack 5 (verified) and by Rollup / Parcel asset plugins)
- `inline.js` (`charturbo/inline`, WASM embedded as base64 — for environments without asset handling such as esbuild), `charturbo.umd.cjs` (UMD, WASM embedded: `<script>` tag · CommonJS `require`)
- Framework entries `react.js` · `vue.js` (import the core chunk; `react` / `vue` are external)
- Types: `index.d.ts` (+ `index.d.cts` / `inline.d.cts` for CJS), `react/` · `vue/` · `sdk/` declarations. `scripts/finalize-dts.mjs` adds the `.js` extension to relative paths so types also resolve under `moduleResolution: node16 / nodenext`.
- To move the WASM file, call `setWasmSource(url | Response | bytes | WebAssembly.Module)` before the first `create()`.
```bash
cd web
npm run build:lib
```

## 3. Publish to NPM
```bash
cd web
npm login
npm publish --access public
```
Run `npm pack --dry-run` before publishing to confirm that only `dist-lib/*`, `README.md`, `CHANGELOG.md` and `LICENSE` go into the package. `prepack` runs `build:lib` again. See [Releasing](./releasing) for the version policy and the full checklist, and [`web/CHANGELOG.md`](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md) for the change history.

## API docs · examples site
```bash
cd web
npm run docs            # TypeDoc → docs/public/api/ (src/index.ts, react, vue entries)
npm run examples:dev    # examples site dev server (web/examples/, one page per chart family + source)
npm run site:dev        # the whole site on http://localhost:5310/: examples + these docs under /docs/ (add `-- --host` for a phone)
npm run examples:build  # static build → web/examples-dist/
```

## Documentation site
This documentation site is a [VitePress](https://vitepress.dev/) project in `docs/`. English lives in `docs/`, Korean in `docs/ko/` and Simplified Chinese in `docs/zh/`, all with the same paths.
```bash
cd docs
npm install
npm run dev             # VitePress dev server, docs only (http://localhost:5173/docs/)
npm run build           # static build → docs/.vitepress/dist/
npm run preview         # preview the build output
npm run check           # locale parity check: every page must exist in en / ko / zh
```
- `npm run check` (`docs/scripts/check-docs.mjs`) collects the sidebar from `docs/.vitepress/config.mts` and the pages under `guide/`, `charts/` and `contributing/`, and fails with exit 1 if a page is missing in any of the three locales or is not in the sidebar.
- To add a page, put its slug and per-locale titles in the sidebar table of `config.mts`, then create the file in all three locales.
- For the API reference (English), `cd web && npm run docs` writes the TypeDoc output to `docs/public/api/`, which the site serves as-is under `/api/`. `docs/public/api/` is ignored by git.

## 4. GPU visual regression tests (`npm run test:visual`)
Renders fixture charts on the GPU in a real headless Chrome and compares the screenshots with baseline images. This is a separate script from `npm test` (vitest).
```bash
cd web
npm run test:visual                           # compare (exit 1 on failure)
npm run test:visual -- --update               # rewrite the baselines (after an intended rendering change)
npm run test:visual -- --backend=webgpu --filter=pie   # narrow by backend / part of the fixture name
npm run test:visual -- --canvas-only          # machines with different fonts: skip the full shots that contain DOM text
npm run test:visual -- --repeat=3             # repeat 3 times in the same process (flake check)
npm run test:visual -- --param=color:#ff00ff  # fixture parameter (break a fixture on purpose to see a failure; cannot be combined with --update)
```
- Layout: `web/e2e/index.html` + `main.ts` + `fixtures.ts` (the fixture page, served by Vite), `run-visual.mjs` (runner), `lib/image.mjs` (dependency-free PNG decode/encode with `node:zlib` + pixel diff). The runner starts its own Vite server on a free port, launches Chrome (`--headless=new --enable-unsafe-webgpu`, `--use-angle=metal` on macOS) with a unique `--user-data-dir` · `--remote-debugging-port`, and opens a fresh page per fixture over the DevTools Protocol.
- Backends: a `webgpu` pass and a forced `webgl2` pass (the page hides `navigator.gpu` before the engine starts so wgpu falls back to the GL backend — the same path as a browser without WebGPU). The actual backend is checked through the canvas context; a mismatch is an error.
- Fixtures (27): 1M-point line (M4 LOD), line dark/light theme, stacked area, grouped bars, scatter, candlestick, histogram (200k samples), heatmap, box · violin, pie · donut, combo, radar · gauge · funnel · waterfall, treemap · sunburst · sankey, vertical-axis zoom (`line-yzoom`) · box zoom (`box-zoom`), a grid of 24 sparklines on a shared `CharturboDevice`, hover (`hoverAtX` → crosshair + marker), navigator (zoom window), brush rectangle (`selectChartRange` xy).
- Two shots: `canvas` = the canvas area only, cropped, with the DOM overlay (title · ticks · legend · color bar · pie labels) hidden via `visibility: hidden` (font-independent, the main check), `full` = the whole card including labels (stable only on the same machine with the same fonts — use `--canvas-only` on another OS / CI).
- Baselines: `web/e2e/baselines/<webgpu|webgl2>/<fixture>.<canvas|full>.png` (108 files). Results: `web/e2e/out/report.html` (baseline / actual / diff side by side), `report.json`, `*.actual.png`, `*.diff.png` (`e2e/out/` is ignored by git).
- Comparison: a pixel differs when the maximum RGBA channel difference exceeds the threshold (canvas 24, full 32 / 255); the test fails when more than 0.2% of pixels differ or the size changes. Diff image: red = above threshold, yellow = difference within threshold, gray = identical.
- Determinism: seeded PRNG (mulberry32), fixed canvas size (480×300, sparklines 140×32), DPR 1 (`deviceScaleFactor: 1`, `--force-device-scale-factor=1`), `--force-color-profile=srgb`, `autoResize: false`, locale `en-US`, fixed UTC dates on time axes, explicit padding (tick label width does not move the plot), emulated `prefers-reduced-motion: reduce` / `prefers-color-scheme: light`. The SDK has no animation here, so each capture is one `render()` + a 3-frame wait. Three consecutive runs on the same machine produced pixel-identical shots (diff 0).
- Baselines are tied to the GPU · driver · Chrome version: if they fail on another machine, check the differences in the report and regenerate them on that machine with `--update`.
- If Chrome is missing (set it with `CHROME_PATH` / `--chrome=<path>`; a path that does not exist is also SKIPPED) or no GPU backend is usable, the runner prints `SKIPPED` and exits 0, or exits 1 with `--strict`. An unusable backend is skipped on its own and the others still run (with `--strict`, any missing backend fails). Harness errors (a `--filter` that matches no fixture, a lost Chrome connection, etc.) exit 2.

## See also
- [Releasing](./releasing)
- [Benchmark Methodology](./benchmarks)
