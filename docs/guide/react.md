# React

`charturbo/react` provides a `<CharturboChart>` component and a `useCharturboChart` hook. Each mounted chart owns one `Charturbo` engine, re-renders only when its props change identity, and exposes the engine through a ref for everything the props do not cover.

[Live example](https://jparkk0517.github.io/Charturbo/react.html)

## Installation

```sh
npm install charturbo react react-dom
```

`react` and `react-dom` (>= 18) are optional peer dependencies. The core entry (`charturbo`) never imports React. `charturbo/react` is ESM only (no CommonJS build).

## Basic usage

```tsx
import { useMemo, useRef } from 'react';
import { CharturboChart, type CharturboChartHandle } from 'charturbo/react';

export function CpuChart({ values, dark }: { values: Float32Array; dark: boolean }) {
  const chart = useRef<CharturboChartHandle>(null);
  // data / options are compared by identity: memoize them so the chart re-renders only when they change
  const data = useMemo(() => [{ name: 'CPU', values }], [values]);
  const options = useMemo(() => ({ title: 'CPU usage', legend: false }), []);

  return (
    <>
      <button onClick={() => chart.current?.sdk?.downloadImage('cpu.png')}>Save PNG</button>
      <CharturboChart
        ref={chart}
        type="line"
        data={data}
        options={options}
        theme={dark ? 'dark' : 'light'} // a change only calls setTheme (data is not re-sent)
        syncGroup="dash"                 // crosshair and zoom / pan synced with charts of the same key
        style={{ height: 320 }}          // wrapper size = canvas size
        onRangeChange={(r) => console.log(r.xMin, r.xMax)}
        onError={(e) => console.error(e)} // CharturboInitError without WebGPU / WebGL2, bad data, ...
      />
    </>
  );
}
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `type` | `CharturboChartType` | required | Chart kind; see [Chart types](#chart-types). |
| `data` | `CharturboChartData<T>` | required | Data of that kind, typed per `type`. |
| `options` | `CharturboChartOptions<T>` | — | Options of the matching `render*` method. |
| `theme` | `'dark' \| 'light' \| CharturboTheme \| CharturboThemeInput` | — (current theme kept) | Calls `setTheme` when it changes. |
| `syncGroup` | `string \| ChartSyncMemberOptions \| null` | — (not synced) | Sync group key, or full member options for `setSync`. |
| `interactions` | `NodeInteractionOptions \| false` | SDK defaults (tooltip, zoom / pan) | Options of `enableNodeInteractions`, with `autoRender: true` added. `false` = static chart. Sparklines get none by default. |
| `createOptions` | `CharturboCreateOptions` | — | `Charturbo.create` options (`locale`, `autoResize` (default `true`), `device`, `animation`, ...). Read once on mount. |
| `className` / `style` | `string` / `CSSProperties` | — | Wrapper `<div>` (gets `position: relative`). Size the chart here. |
| `canvasClassName` / `canvasStyle` | `string` / `CSSProperties` | — | The inner `<canvas>` (default style: `display: block; width: 100%; height: 100%`). |
| `onReady`, `onError`, `on*` | functions | — | See [Events](#events). |

## Chart types

| `type` | SDK method |
|---|---|
| `'line'`, `'area'`, `'band'` | `renderLineChart`, `renderAreaChart`, `renderBandChart` |
| `'errorBar'`, `'impulse'` | `renderErrorBarChart`, `renderImpulseChart` |
| `'bar'` | `renderBarChart` when `data` is an array; `renderGroupedBarChart` when it is `{ categories, series }` |
| `'scatter'`, `'histogram'`, `'heatmap'`, `'box'` | `renderScatterChart`, `renderHistogram`, `renderHeatmap`, `renderBoxPlot` |
| `'candlestick'`, `'ohlc'` | `renderCandlestickChart`, `renderOhlcChart` |
| `'pie'`, `'combo'`, `'radar'`, `'gauge'`, `'funnel'`, `'waterfall'` | `renderPieChart`, `renderComboChart`, `renderRadarChart`, `renderGauge`, `renderFunnelChart`, `renderWaterfallChart` |
| `'treemap'`, `'sunburst'`, `'sankey'` | `renderTreemap`, `renderSunburst`, `renderSankey` |
| `'sparkline'` | `renderSparkline` |
| `'pointCloud3d'`, `'surface3d'` | `renderPointCloud3D`, `renderSurface3D` |

## Events

| Prop | Payload | When |
|---|---|---|
| `onReady` | `Charturbo` | The engine is created and the first chart rendered. |
| `onError` | `unknown` | `create` failed (`CharturboInitError` without WebGPU / WebGL2) or a render threw (bad data). |
| `onHover` | `CharturboEventMap['hover']` | Hover target changed. |
| `onClick` | `CharturboEventMap['click']` | Click or tap without dragging. |
| `onSelect` | `CharturboEventMap['select']` | Brush selection committed or cleared. |
| `onRangeChange` | `CharturboRange` (`xMin`, `xMax`, `yMin?`, `yMax?`) | Visible range changed (zoom, pan, reset, `setXRange`). |
| `onLegendToggle` | `{ series, visible }` | A series was shown or hidden. |
| `onThemeChange` | `CharturboTheme` | Theme changed. |
| `onResize` | `{ width, height }` | Render target resized (physical px). |
| `onDrill` | `CharturboEventMap['drill']` | Treemap / sunburst drilled down or up. |

Callbacks may be inline functions: the component always calls the latest one and never resubscribes. Render errors go to `onError` instead of being thrown.

## Accessing the SDK

The ref is a `CharturboChartHandle`:

| Member | Type | Description |
|---|---|---|
| `sdk` | `Charturbo \| null` | The engine; `null` before it is ready and after unmount. |
| `canvas` | `HTMLCanvasElement \| null` | The inner canvas. |
| `whenReady()` | `Promise<Charturbo \| null>` | Resolves with the engine, or `null` when unmounted first or `create` failed. |

```tsx
chart.current?.sdk?.setXRange(0, 100);
const sdk = await chart.current?.whenReady();
await sdk?.downloadChartPDF('cpu.pdf');
```

Use the SDK for anything the props do not cover: export, `setXRange`, `resetChartZoom`, [streaming](./streaming) appends. `onReady={(sdk) => ...}` is an alternative to the ref for one-time setup.

## Update rules and memoization

The component never deep-compares props:

- `type`, `data`, `options`: when any of their **references** changes, the chart is rendered again with one `render*` call. A new object or array on every parent render (for example an inline `{ title: 'CPU' }` literal in `options`) re-renders the chart every time. Keep these values in `useMemo`, state, or module constants.
- Mutating a typed array in place is not detected; pass a new array or object. For high-frequency updates, call the SDK's streaming methods through the ref instead of changing `data`.
- `theme`: a change only calls `setTheme`; data is not re-sent. `undefined` keeps the current theme.
- `syncGroup`: `setSync` is called only when the key or the flags (`cursor`, `x`, `tooltip`) change, so an inline object is fine.
- `interactions`: a new reference re-binds `enableNodeInteractions`. Memoize objects you pass here.
- `createOptions`: read once on mount; later changes are ignored. Remount (for example with a `key`) to apply new ones.
- Props that change before the engine is ready are applied once, with their latest values, right after it is ready.

## The `useCharturboChart` hook

Use the hook when you lay out the canvas yourself. The canvas parent must be positioned: labels, legend and tooltip overlays mount there.

```tsx
import { useCharturboChart } from 'charturbo/react';

function Revenue({ items }: { items: { label: string; value: number }[] }) {
  const { canvasRef, sdk, error } = useCharturboChart({ type: 'bar', data: items });
  return (
    <div style={{ position: 'relative', height: 240 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
```

The hook takes the same props as the component (without `className` / `style` / `canvas*`) and returns:

| Member | Type | Description |
|---|---|---|
| `canvasRef` | `RefObject<HTMLCanvasElement \| null>` | Attach to a `<canvas>`. |
| `sdk` | `Charturbo \| null` | The engine once ready (state: changing it re-renders the component). |
| `error` | `unknown` | Last `create` / render error. |
| `getSdk()` | `Charturbo \| null` | The live engine without a re-render (inside `onReady`, after `whenReady`). |
| `whenReady()` | `Promise<Charturbo \| null>` | Same as the handle. Returns `null` if called before the mount effect ran. |

## Sizing

The wrapper `<div>` has `position: relative`; the overlay labels and legend attach to it. Give it a size with `className` or `style`: the canvas fills it at 100%, and the SDK's `autoResize` matches the backing store with a `ResizeObserver`.

## Lifecycle

- The engine is created once on mount (`Charturbo.create`, asynchronous) and disposed on unmount.
- If the component unmounts before creation finishes, the arriving engine is disposed immediately and no callback fires.
- React StrictMode's mount → unmount → mount creates only one engine: creation is deferred by one microtask, so the first binding is discarded before it starts.

## SSR

- Importing `charturbo/react` in Node is safe: there is no `window` / `document` access at import time.
- The engine is created only in a client effect. On the server, the component renders only the `<div><canvas></canvas></div>` markup.
- The entry has no `'use client'` directive. In React Server Components frameworks (for example Next.js App Router), render `<CharturboChart>` from a file marked `'use client'`.

## See also

- [Vue](./vue)
- [Shared GPU Device](./shared-device)
- [Dashboard Sync](./dashboard-sync)
- [Interactions](./interactions)
- [Installation & Bundlers](./installation)
