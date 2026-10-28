# Getting Started

This page builds an interactive line chart with one million points. It assumes a bundler such as Vite; for other setups see [Installation & Bundlers](./installation).

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Install

::: warning
The `charturbo` package is not published to npm yet. Until the first release, build it from source and install the tarball: see [Build from source](./installation#build-from-source).
:::

After the release:

```bash
npm install charturbo
```

## Add a canvas

The SDK draws into a `<canvas>` and adds DOM elements for the title, legend, axis labels and tooltips. Those elements are appended to the canvas's parent and positioned from the canvas offset, so wrap the canvas in a container with `position: relative`. Give the canvas a CSS size; its pixel size follows automatically.

```html
<div class="chart">
  <canvas id="chart"></canvas>
</div>

<style>
  .chart { position: relative; height: 360px; }
  .chart canvas { display: block; width: 100%; height: 100%; }
</style>
```

## Draw your first chart

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector<HTMLCanvasElement>('#chart')!;
const sdk = await Charturbo.create(canvas);

// 1,000,000 samples in a Float32Array
const values = new Float32Array(1_000_000);
let walk = 0;
for (let i = 0; i < values.length; i++) {
  walk += (Math.random() - 0.5) * 0.4;
  values[i] = walk;
}

sdk.renderLineChart([{ name: 'Sensor A', values }], {
  title: 'Telemetry',
  axes: { x: { title: 'Sample', format: '.2s' }, y: { format: '.1f' } },
});
sdk.render();
```

What happens here:

1. `Charturbo.create(canvas)` loads the WebAssembly module (once per page) and starts the engine on WebGPU, or on WebGL2 when WebGPU is unavailable.
2. `renderLineChart` sends the data to the engine. Without `x`, samples are spaced by index.
3. `render()` draws a frame. The SDK has no idle render loop: call `render()` after you change something.

## Add interactions

```ts
sdk.enableNodeInteractions(canvas, { autoRender: true });
```

This turns on the tooltip, wheel zoom on the x axis, drag to pan and double-click to reset. On touch devices: pinch to zoom, drag to pan, tap to pin a tooltip, long-press to scrub, double-tap to reset. `autoRender: true` calls `render()` after every interaction; without it, you draw frames yourself.

The call returns a function that removes the listeners again. See [Interactions](./interactions) for zoom axes, box zoom, brush selection and touch options.

## Update the data

```ts
// Append a chunk and keep the newest 100,000 samples
sdk.appendSeriesData(0, nextChunk, undefined, { maxPoints: 100_000 });
sdk.render();
```

`setSeriesData(seriesIndex, values, x?)` replaces one series and keeps the style and zoom. See [Real-time Streaming](./streaming).

## Handle unsupported browsers

```ts
import { Charturbo, CharturboInitError } from 'charturbo';

if (!(await Charturbo.isSupported())) {
  showFallback(); // neither a WebGPU adapter nor WebGL2
} else {
  try {
    const sdk = await Charturbo.create(canvas);
    // ...
  } catch (e) {
    if (e instanceof CharturboInitError) console.warn(e.reason); // 'no-webgpu' | 'adapter' | 'device' | 'wasm'
  }
}
```

## Clean up

```ts
sdk.dispose(); // removes listeners and overlay DOM, releases the engine
```

Call it when the chart leaves the page (route change, component unmount). The React and Vue components do this for you.

## Using React or Vue

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={series} options={{ title: 'CPU' }} style={{ height: 300 }} />;
```

See [React](./react) and [Vue](./vue).

## Next steps

- [Core Concepts](./core-concepts): the engine lifecycle, rendering and resizing.
- [Data & Axes](./data-and-axes): x values, time axes, log scales.
- [Charts](../charts/line): one page per chart type.
- [Performance](./performance): tips for very large data.
