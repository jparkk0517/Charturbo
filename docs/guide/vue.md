# Vue

`charturbo/vue` provides a `<CharturboChart>` component and a `useCharturboChart` composable for Vue 3. Each mounted chart owns one `Charturbo` engine, re-renders only when a prop is replaced (shallow watch), and exposes the engine through a template ref.

[Live example](https://jparkk0517.github.io/Charturbo/vue.html)

## Installation

```sh
npm install charturbo vue
```

`vue` (>= 3.3) is an optional peer dependency. The core entry (`charturbo`) never imports Vue. `charturbo/vue` is ESM only (no CommonJS build).

## Basic usage

```vue
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { CharturboChart, type CharturboChartInstance } from 'charturbo/vue';

const data = shallowRef([{ name: 'CPU', values: new Float32Array(10_000) }]);
const options = { title: 'CPU usage' }; // a constant: an inline object in the template is a new reference on every render
const chart = ref<CharturboChartInstance | null>(null);

function update(values: Float32Array) {
  data.value = [{ name: 'CPU', values }]; // replace the array to re-render (shallow watch)
}
</script>

<template>
  <button @click="chart?.sdk?.downloadChartSVG('cpu.svg')">Save SVG</button>
  <CharturboChart
    ref="chart"
    type="line"
    :data="data"
    :options="options"
    theme="light"
    sync-group="dash"
    style="height: 320px"
    @range-change="(r) => console.log(r.xMin, r.xMax)"
    @error="(e) => console.error(e)"
  />
</template>
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `type` | `CharturboChartType` | required | Chart kind; same values as [React](./react#chart-types). |
| `data` | `CharturboChartData` | required | Data of that kind (typed arrays, descriptor arrays, objects; no runtime type check). |
| `options` | `CharturboChartOptions` | — | Options of the matching `render*` method. |
| `theme` | `'dark' \| 'light' \| CharturboTheme \| CharturboThemeInput` | — (current theme kept) | Calls `setTheme` when it changes. |
| `sync-group` | `string \| ChartSyncMemberOptions \| null` | — (not synced) | Sync group key, or full member options for `setSync`. |
| `interactions` | `NodeInteractionOptions \| false` | SDK defaults (tooltip, zoom / pan) | Options of `enableNodeInteractions`, with `autoRender: true` added. `false` = static chart. Sparklines get none by default. |
| `create-options` | `CharturboCreateOptions` | — | `Charturbo.create` options (`locale`, `autoResize` (default `true`), `device`, `animation`, ...). Read once when the component is set up. |
| `canvas-class` | `string` | — | Class of the inner `<canvas>`. |

`class` and `style` fall through to the wrapper `<div>` (which has `position: relative`). Size the chart there.

## Events

| Event | Payload | When |
|---|---|---|
| `@ready` | `Charturbo` | The engine is created and the first chart rendered. |
| `@error` | `unknown` | `create` failed (`CharturboInitError` without WebGPU / WebGL2) or a render threw (bad data). |
| `@hover` | `CharturboEventMap['hover']` | Hover target changed. |
| `@click` | `CharturboEventMap['click']` | Click or tap without dragging. |
| `@select` | `CharturboEventMap['select']` | Brush selection committed or cleared. |
| `@range-change` | `CharturboRange` (`xMin`, `xMax`, `yMin?`, `yMax?`) | Visible range changed (zoom, pan, reset, `setXRange`). |
| `@legend-toggle` | `{ series, visible }` | A series was shown or hidden. |
| `@theme-change` | `CharturboTheme` | Theme changed. |
| `@resize` | `{ width, height }` | Render target resized (physical px). |
| `@drill` | `CharturboEventMap['drill']` | Treemap / sunburst drilled down or up. |

Render errors are emitted as `error` instead of being thrown.

## Accessing the SDK

The template ref is a `CharturboChartInstance` (exposed refs are unwrapped):

| Member | Type | Description |
|---|---|---|
| `sdk` | `Charturbo \| null` | The engine; `null` before it is ready and after unmount. |
| `error` | `unknown` | Last `create` / render error. |
| `canvas` | `HTMLCanvasElement \| null` | The inner canvas. |
| `whenReady()` | `Promise<Charturbo \| null>` | Resolves with the engine, or `null` when unmounted first or `create` failed. |

```ts
const chart = ref<CharturboChartInstance | null>(null);
chart.value?.sdk?.setXRange(0, 100);
const sdk = await chart.value?.whenReady();
```

Use the SDK for anything the props do not cover: export, `setXRange`, `resetChartZoom`, [streaming](./streaming) appends.

## Update rules and reactivity

Watches are shallow: each prop is compared by identity, never deeply.

- `type`, `data`, `options`: when any of them is **replaced**, the chart is rendered again with one `render*` call (one call even if several change in the same tick).
- Keep `data` in a `shallowRef` and assign a new array or object to update it. Mutating a `reactive` array in place, or a typed array, is not seen. `shallowRef` also avoids deep proxies over large data.
- An inline object in the template (`:options="{ title: 'CPU' }"`) is a new reference on every parent render and re-renders the chart each time. Use a constant, a `shallowRef`, or a `computed`.
- `theme`: a change only calls `setTheme`; data is not re-sent. `undefined` keeps the current theme.
- `sync-group`: `setSync` is called only when the key or the flags (`cursor`, `x`, `tooltip`) change.
- `interactions`: a new reference re-binds `enableNodeInteractions`.
- `create-options`: read once; later changes are ignored. Remount (for example with a `key`) to apply new ones.
- Values are unwrapped with `toRaw` before they reach the SDK.

## The `useCharturboChart` composable

Use the composable when you lay out the canvas yourself. Pass a template ref to a `<canvas>` whose parent is positioned; labels, legend and tooltip overlays mount there.

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';
import { useCharturboChart } from 'charturbo/vue';

const canvas = shallowRef<HTMLCanvasElement | null>(null);
const items = shallowRef([{ label: 'A', value: 3 }, { label: 'B', value: 5 }]);
const { sdk, error, whenReady } = useCharturboChart(canvas, { type: 'bar', data: items });
</script>

<template>
  <div style="position: relative; height: 240px">
    <canvas ref="canvas" style="width: 100%; height: 100%" />
  </div>
</template>
```

`useCharturboChart(canvasRef, props)` takes the same props as the component, as plain values, refs or getters (`MaybeRefOrGetter`), plus `on*` callbacks (`onReady`, `onError`, `onHover`, `onRangeChange`, ...). It returns:

| Member | Type | Description |
|---|---|---|
| `sdk` | `ShallowRef<Charturbo \| null>` | The engine once ready. |
| `error` | `ShallowRef<unknown>` | Last `create` / render error. |
| `whenReady()` | `Promise<Charturbo \| null>` | Same as the component instance. |

## Lifecycle

- The engine is created once in `onMounted` (`Charturbo.create`, asynchronous) and disposed in `onBeforeUnmount`.
- If the component unmounts before creation finishes, the arriving engine is disposed immediately and no event is emitted.

## SSR

- Importing `charturbo/vue` in Node is safe: there is no `window` / `document` access at import time.
- The engine is created only in `onMounted`, which does not run on the server. Server rendering outputs only the `<div><canvas></canvas></div>` markup.

## See also

- [React](./react)
- [Shared GPU Device](./shared-device)
- [Dashboard Sync](./dashboard-sync)
- [Interactions](./interactions)
- [Installation & Bundlers](./installation)
