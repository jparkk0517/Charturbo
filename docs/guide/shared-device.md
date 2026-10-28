# Shared GPU Device

`CharturboDevice` lets many charts share one GPU adapter, device and set of compiled pipelines. Use it on pages with dozens to hundreds of charts, such as dashboards and tables of sparklines.

[Live example](https://jparkk0517.github.io/Charturbo/sparklines.html)

## Why it is needed

`Charturbo.create(canvas)` requests its own adapter and device for each canvas and compiles every pipeline. Browsers also cap live WebGL contexts at about 16, so a page of 100 charts fails on the WebGL2 fallback.

A `CharturboDevice` owns one instance, adapter, device and queue, plus one pipeline set cached per surface format. Each engine on it keeps only its surface configuration, depth texture, uniforms and instance buffers; those buffers start at 16 elements and grow when needed.

## Basic usage

```ts
import { CharturboDevice, Charturbo } from 'charturbo';

const device = await CharturboDevice.create(); // { backend: 'auto' | 'webgpu' | 'webgl2' }
const charts: Charturbo[] = [];

for (const row of rows) {
  // No adapter / device request, no pipeline compilation
  const sdk = await Charturbo.create(row.canvas, { device });
  sdk.renderSparkline(row.values, { type: 'line', showLast: true, showMinMax: true, label: row.name });
  sdk.render();
  charts.push(sdk);
}

device.engineCount; // live engines on this device

// Teardown
for (const sdk of charts) sdk.dispose();
device.dispose();
```

Every other `Charturbo.create` option (`locale`, `autoResize`, `timeZone`, `sync`, `animation`) works the same with `device`.

## API

`CharturboDevice.create(options?)` returns `Promise<CharturboDevice>`.

| Option | Type | Default | Description |
|---|---|---|---|
| `backend` | `'auto' \| 'webgpu' \| 'webgl2'` | `'auto'` | `'auto'`: WebGPU when an adapter is available, else WebGL2. |

It throws a `CharturboInitError` (`'no-webgpu'`, `'adapter'`, `'device'`, `'wasm'`) like `Charturbo.create`.

| Member | Type | Description |
|---|---|---|
| `backend` | `'webgpu' \| 'webgl2'` | Backend every engine of this device renders with. |
| `engineCount` | `number` | Engines currently alive on this device (`0` after `dispose()`). |
| `pipelineSets` | `number` | Pipeline sets compiled: one per surface format, however many engines. |
| `disposed` | `boolean` | `dispose()` was called; no new engines. |
| `dispose()` | `void` | Releases this handle. |

## Backends

- **WebGPU**: each canvas gets its own `GPUCanvasContext` configured with the shared device, so N canvases = N surfaces and 1 device.
- **WebGL2 fallback**: a GL context can only present to its own canvas. The device renders each engine into one hidden shared canvas (resized to that engine's size when it differs) and copies the frame into the engine's canvas with a 2D `drawImage` in the same task. One WebGL context serves any number of canvases.

::: warning
On the WebGL2 path, engine canvases use a `2d` context. Pass fresh canvases: a canvas that already has a `webgl2` or `webgpu` context cannot be attached. Canvases of mixed sizes cost a shared-canvas resize on every frame, so keep sizes uniform where possible.
:::

## Lifetime

- Engines keep the device alive. Disposing the last engine keeps the device for new engines.
- `device.dispose()` releases the handle. Engines still alive keep working; the GPU device is freed once they are disposed too. Later `Charturbo.create(canvas, { device })` calls throw `CharturboDevice is disposed`.
- Engines created on a device default to 0 graph nodes and edges (`Charturbo.create` without `device` defaults to 1000 / 2000).
- Module initialization shares one promise with `Charturbo.create`: concurrent calls instantiate WebAssembly once.

## With React and Vue

Pass the device through `createOptions` (read once on mount). For sparklines, also pass `interactions={false}`:

```tsx
<CharturboChart type="sparkline" data={values} options={{ label: 'Revenue' }} createOptions={{ device }} interactions={false} />
```

See [React](./react) and [Vue](./vue).

## Performance

Measured in headless Chrome with 120 × 30 sparklines:

| Case | Create + first render |
|---|---|
| 100 sparklines, WebGPU | 165 ms |
| 100 sparklines, WebGL2 | 717 ms |
| 200 sparklines, WebGPU | 234 ms |

One pipeline set and no overlay DOM in every case. Per engine, CPU memory is about 67 KB and the initial GPU allocation about 73 KB (240 × 60 backing store, including a 57 KB depth texture), against about 813 KB for a default engine.

## See also

- [Sparkline](../charts/sparkline)
- [Performance](./performance)
- [Installation & Bundlers](./installation)
