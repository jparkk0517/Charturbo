# Core Concepts

This page explains how a `Charturbo` instance works: how it is created, when it draws, how it follows the canvas size and how it is released. Read it once before building anything beyond a single static chart.

## One canvas, one SDK

A `Charturbo` instance owns one engine bound to one `<canvas>`. It shows one view at a time: a chart, a 3D graph or embedding cloud, or a 3D scene.

- Each `render*` call (`renderLineChart`, `renderBarChart`, ...) replaces the current chart of that instance.
- To show two charts side by side, create two canvases and two instances.
- For pages with many charts, let the instances share one GPU device with `Charturbo.create(canvas, { device })`: see [Shared GPU Device](./shared-device).

## Creating an instance

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { locale: 'en-US', autoResize: true });
```

`Charturbo.create(canvas, options?)` loads the WebAssembly module (once per page), starts the engine on WebGPU or WebGL2, and resolves with the instance.

| Option | Type | Default | Description |
|---|---|---|---|
| `autoResize` | `boolean` | `true` | Keep `canvas.width` / `height` at the CSS size × device pixel ratio and call `resize()` + `render()` on change |
| `locale` | `string` | page language (`<html lang>`), then browser language | Locale of number / date labels, tooltip values and built-in UI text (see [Internationalization](./i18n)) |
| `timeZone` | `CharturboTimeZone` | `'local'` | Zone of time axes, labels and tooltips: `'local'`, `'UTC'` or an IANA name |
| `sync` | `ChartSyncMemberOptions` | none | Join a cursor / zoom sync group (see [Dashboard Sync](./dashboard-sync)) |
| `animation` | `ChartAnimationInput` | off | Enter / update animations (see [Animation](./animation)) |
| `device` | `CharturboDevice` | none | Shared GPU device: no adapter / device request, cached pipelines |
| `seed` | `number` | `42` | Seed of the generated starter graph |
| `nodeCount` | `number` | `1000` (`0` with `device`) | Nodes of the generated starter graph |
| `edgeCount` | `number` | `2000` (`0` with `device`) | Edges of the generated starter graph |
| `clusterCount` | `number` | `8` (`1` with `device`) | Clusters of the generated starter graph |

The last four options only matter for graph views: the engine starts with a seeded random graph that is shown until you render a chart or load your own data (`loadDataset`, `loadEmbeddings`). Chart-only apps can ignore them.

`create` rejects with a `CharturboInitError` whose `reason` says what failed:

| `reason` | Meaning |
|---|---|
| `'no-webgpu'` | Neither WebGPU nor WebGL2 is available, or the canvas surface could not be created |
| `'adapter'` | No suitable GPU adapter |
| `'device'` | The adapter refused a device |
| `'wasm'` | The WebAssembly module failed to load |

`Charturbo.isSupported()` checks in advance whether a WebGPU adapter or WebGL2 is available. `create` can still fail on a device-level error.

## Rendering

The SDK separates *describing* a chart from *drawing* a frame:

- `render*` methods and setters (`setSeriesData`, `setTheme`, `setXRange`, ...) change engine state.
- `render()` draws one frame and updates the overlay DOM.

There is no idle render loop. Call `render()` after you change something:

```ts
sdk.renderLineChart(series, { title: 'Throughput' });
sdk.render();

sdk.appendSeriesData(0, chunk);
sdk.render();
```

The SDK calls `render()` for you in these cases:

| Trigger | When |
|---|---|
| `autoResize` | After the canvas pixel size changes |
| `enableNodeInteractions(canvas, { autoRender: true })` | After hover, zoom, pan, legend clicks and other interactions (`autoRender` defaults to `false`) |
| Animations | Every frame while an enter / update animation runs, then it stops |
| React / Vue components | After prop changes; interactions use `autoRender: true` by default |

Graph physics (`stepPhysics`, `stepPhysicsAsync`) never renders on its own. Drive it from your own `requestAnimationFrame` loop and call `render()` after each step.

## Replacing and updating a chart

Calling a `render*` method again replaces the chart: the overlay DOM is rebuilt, annotations are reset and the zoom history starts empty. Each `render*` method returns a small summary, such as `{ totalPoints, seriesCount }` for line charts.

To change data without replacing the chart (keeping style and zoom), use the update methods of that chart type, for example `setSeriesData`, `appendSeriesData` and `appendAreaData` for line and area charts. See [Real-time Streaming](./streaming) and the chart pages.

`loadDataset` and `loadEmbeddings` switch the instance from a chart to a graph view and remove the chart overlay.

## Size and pixel ratio

With `autoResize: true` (the default) the SDK observes the canvas:

- It uses `ResizeObserver` with `device-pixel-content-box` when the browser reports it, else the CSS size × `devicePixelRatio`. A `matchMedia` query catches zoom and monitor changes that keep the CSS size.
- It sets `canvas.width` / `height`, calls `resize(width, height)` and `render()`. Sizes are capped at 8192 px per side (aspect kept).
- A canvas without a CSS size would grow on every resize; the first time that happens the SDK pins its CSS size.

If your app sizes the canvas itself, turn it off and report the size:

```ts
const sdk = await Charturbo.create(canvas, { autoResize: false });

function fit() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  sdk.resize(canvas.width, canvas.height);
  sdk.render();
}
```

`resize(width, height)` takes physical pixels and emits the `'resize'` event. The engine derives the stroke pixel ratio from the canvas on `resize()`; `setPixelRatio(ratio)` overrides it.

The overlay (title, legend, axis labels) is appended to the canvas's parent element and positioned from the canvas offset. Put the canvas in a container with `position: relative`.

## Lifecycle

```ts
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });
// ...
detach();      // removes only these listeners and the tooltip
sdk.dispose(); // releases everything
```

`dispose()`:

- leaves the sync group and stops the auto-resize observer,
- stops a running animation and removes all event handlers,
- detaches every `enableNodeInteractions` binding,
- removes the overlay DOM and the accessibility elements,
- releases the WebAssembly engine.

Calling it twice is safe. Do not use the instance afterwards; methods such as `stepPhysicsAsync` throw `Engine is disposed`. The React and Vue components dispose their engine on unmount.

## Themes

The default theme is `'dark'`. `setTheme` accepts `'dark'`, `'light'` or a theme object; `getTheme()` returns the active theme and `CHARTURBO_THEMES` holds the built-in ones.

```ts
sdk.setTheme('light');
sdk.setTheme({ ...sdk.getTheme(), name: 'brand', palette: ['#3182f6', '#14b8a6', '#f59e0b'] });
sdk.render();
```

`setTheme` restyles the background, text, grid, tooltips and theme-driven chart styles. Colors you passed explicitly to a series stay until you call the `render*` method again. See [Styling & Themes](./styling).

## Events

`sdk.on(event, handler)` subscribes and returns the unsubscribe function; `sdk.off(event, handler)` also works.

| Event | Payload | Fires when |
|---|---|---|
| `hover` | `CharturboHoverEvent` | The hover target changes (needs `enableNodeInteractions`) |
| `click` | `CharturboClickEvent` | Click or tap without dragging (needs `enableNodeInteractions`) |
| `rangechange` | `CharturboRange` | The visible range changes (zoom, pan, reset, `setXRange`), at most once per frame |
| `legendtoggle` | `{ series, visible }` | A series is shown or hidden |
| `select` | `CharturboSelection` | A brush selection is committed or cleared |
| `drill` | `CharturboDrillEvent` | A treemap / sunburst drills down or up |
| `themechange` | `CharturboTheme` | The theme changes |
| `resize` | `{ width, height }` | The render target is resized (physical px) |

```ts
const off = sdk.on('rangechange', ({ xMin, xMax }) => console.log(xMin, xMax));
off();
```

## Locale and time zone

`locale` (create option or `sdk.setLocale`) drives `Intl` number and date formatting and the language of built-in UI text: accessibility summaries, data table headers, tooltip field labels, export and legend text. English, Korean and Simplified Chinese are built in; other locales fall back to English. Without a locale, the page language (`<html lang>`) is used, then the browser language. Charts can override it with their own `locale` option. `timeZone` (or `sdk.setTimeZone`) sets the zone of time axes. See [Internationalization](./i18n) and [Number & Date Formats](./number-format).

## See also

- [Getting Started](./getting-started)
- [Interactions](./interactions)
- [Performance](./performance)
