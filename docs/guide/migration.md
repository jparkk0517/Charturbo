# Changelog & Migration

This page explains how Charturbo versions change and lists the breaking changes you need to act on when upgrading. The full list of changes is in the [CHANGELOG](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md).

## Versioning (0.x)

Until 1.0.0, Charturbo follows the [SemVer](https://semver.org/) 0.x convention:

| Change | Version part | Example |
|---|---|---|
| Incompatible public API change: renamed or removed names, signatures, defaults, event payloads or exported types; intentional rendering changes; narrower browser / Node / peer support | **minor** | 0.1.x → 0.2.0 |
| Backward-compatible additions: new chart types, options, methods or exported types | **minor** | 0.1.x → 0.2.0 |
| Bug fixes, performance, docs, internal changes that do not change rendering | **patch** | 0.1.0 → 0.1.1 |

- A minor release can contain both new features and breaking changes. Breaking changes are listed in the CHANGELOG with migration steps.
- The npm default range `^0.1.0` (`>=0.1.0 <0.2.0`) receives patches only. Read the CHANGELOG before a minor upgrade.
- Deprecated APIs are marked `@deprecated` in JSDoc and kept for at least one minor release before removal.
- The public API is what `charturbo`, `charturbo/inline`, `charturbo/react` and `charturbo/vue` export. The WebAssembly bindings (`snake_case` methods of `WasmCharturboEngineBackend`) and internal paths (`dist-lib/sdk/*`) are not public API.
- Pre-releases use versions such as `0.2.0-rc.1` and the npm `next` tag.

## Current status

0.1.0 is the first release and is not published yet. The changes below are in the unreleased section and matter if you built an earlier snapshot from source.

## Breaking changes

### Renamed to Charturbo

The product was renamed. Replace the old names:

| Before | After |
|---|---|
| package `viz-engine-sdk` | `charturbo` |
| `viz-engine-sdk/inline`, `/react`, `/vue` | `charturbo/inline`, `charturbo/react`, `charturbo/vue` |
| `VizEngineSDK` | `Charturbo` |
| `VizDevice` | `CharturboDevice` |
| `VizInitError` | `CharturboInitError` |
| `VIZ_THEMES` | `CHARTURBO_THEMES` |
| Other `Viz*` types (`VizTheme`, `VizEventMap`, `VizCreateOptions`, ...) | `Charturbo*` (`CharturboTheme`, `CharturboEventMap`, `CharturboCreateOptions`, ...) |
| React / Vue `VizChart`, `useVizChart` | `CharturboChart`, `useCharturboChart` |
| WebAssembly file `viz_core_bg.wasm` | `charturbo_core_bg.wasm` |
| UMD file `viz-engine-sdk.umd.cjs`, global `VizEngineSDK` | `charturbo.umd.cjs`, global `Charturbo` |
| CSS classes `viz-sdk-*` | `charturbo-sdk-*` |
| Export opt-out attribute `data-viz-export="false"` | `data-charturbo-export="false"` |

```ts
// Before
import { VizEngineSDK } from 'viz-engine-sdk';
const sdk = await VizEngineSDK.create(canvas);

// After
import { Charturbo } from 'charturbo';
const sdk = await Charturbo.create(canvas);
```

Update stylesheets that target the overlay classes, and any `setWasmSource` path or copy step that names the `.wasm` file.

### `stepPhysicsAsync` resolves at submission

The GPU graph step now keeps the layout on the GPU. See the Unreleased section of the CHANGELOG.

| Before | After |
|---|---|
| The promise resolved after the GPU result was read back and applied | The promise resolves once the step is submitted; the CPU copy of positions trails by one or two frames |
| Data or force changes made during a GPU step caused that result to be rejected | CPU edits (`moveNode`, `pinNode`, styles, `loadDataset`, `stepPhysics`) are applied in order |

If you pick nodes, export, read node details or check `isSleeping()` right after a step, wait for the positions first:

```ts
await sdk.stepPhysicsAsync(0.016);
await sdk.syncPhysicsPositions(); // only when positions must be current
const id = sdk.pickNodeAtNdc(x, y);
```

Still await each `stepPhysicsAsync` before starting another; overlapping calls throw `A physics step is already pending`.

### Built-in text and numbers follow the locale

Built-in UI text (accessibility summaries, data tables and CSV headers, default tooltips, legend, breadcrumb and colorbar labels, default series names, the PDF title) is now English, Korean or Simplified Chinese depending on the locale. This also changes some English output:

| Before | After |
|---|---|
| Numbers formatted as `en-US` | Numbers formatted with the chart locale; without one, the page language (`<html lang>`), then the browser language |
| Default scatter series names counted from 0 | Counted from 1 (`Series 1`) |
| `getNodeDetails().metadata.description` of combo, line and bar points always in Korean | Follows the locale |
| Box-plot percentile whiskers `1th`; other English wording | `1st`; OHLC keyboard help, data table title, pie "Other" tooltip and combo description corrected |

To keep English text and `en-US` numbers regardless of the page language, set the locale explicitly:

```ts
const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
```

Tests or snapshots that compare summaries, CSV headers or tooltip text may need new baselines. See [Internationalization](./i18n).

## Deprecated options

These options are still accepted but have no effect or map to a replacement. Remove them when you touch the code:

| Option | Status |
|---|---|
| `LineSeriesDescriptor.zOffset` | Ignored; the engine lays out series depth |
| `LineSeriesDescriptor.pointSize` | Use `marker: { size }` (mapped to it when `marker` is not given) |
| `BarChartItemDescriptor.row`, `col` | Ignored; the engine computes the 3D layout |
| `ScatterChartData.z` | Ignored; the scatter chart is 2D |
| `ScatterChartOptions.viewMode` | Only `'2d'` is supported |

## See also

- [CHANGELOG](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md)
- [Releasing](../contributing/releasing)
- [Installation & Bundlers](./installation)
