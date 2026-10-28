# FAQ & Troubleshooting

Answers to common setup problems. Each entry names the symptom, the cause and the fix.

## `Charturbo.create` rejects

`create` throws a `CharturboInitError`. Check `error.reason`:

| `reason` | Cause | What to do |
|---|---|---|
| `'no-webgpu'` | Neither WebGPU nor WebGL2 is available, or the canvas surface could not be created | Show a fallback. Check `Charturbo.isSupported()` before creating. With a shared WebGL2 device, use a canvas that has no context yet |
| `'adapter'` | No suitable GPU adapter | Usually a blocked or missing GPU driver. Also the result of the WebGPU-only build on a browser without WebGPU |
| `'device'` | The adapter refused a device | Retry later or show a fallback |
| `'wasm'` | The WebAssembly module failed to load | See [The WebAssembly module does not load](#wasm-load) |

```ts
try {
  sdk = await Charturbo.create(canvas);
} catch (e) {
  if (e instanceof CharturboInitError) showFallback(e.reason);
  else throw e;
}
```

## WebGPU is not used

The default build silently falls back to WebGL2 when there is no WebGPU adapter. Common reasons:

- The page is not a secure context. WebGPU is only exposed on HTTPS and `localhost`.
- The browser has no WebGPU yet. WebGPU needs Chrome / Edge 113+ or Safari 26+.
- The GPU or driver is blocklisted by the browser.

To see which backend a shared device uses, read `CharturboDevice.backend` (`'webgpu'` or `'webgl2'`). On WebGL2 everything works, but `stepPhysicsAsync` runs on the CPU and peak WebAssembly memory is higher.

## The WebAssembly module does not load {#wasm-load}

The `charturbo` entry fetches `charturbo_core_bg.wasm` from the URL next to the JavaScript chunk. The error is a `CharturboInitError` with reason `'wasm'` and a message starting with `Failed to load the WebAssembly module:`.

| Symptom | Cause | Fix |
|---|---|---|
| Message contains `failed to fetch Wasm: 404` | The bundler did not emit the `.wasm` file, or the server does not serve it | Use Vite or webpack 5, add a copy step and `setWasmSource(url)`, or switch to `charturbo/inline` |
| Console warning that the server `does not serve Wasm with application/wasm MIME type` | Wrong `Content-Type` | Serve `.wasm` as `application/wasm`. Loading still works, but slower |
| Load fails after a CSP violation in the console | `script-src` blocks WebAssembly compilation, or `connect-src` blocks the fetch | See [Content Security Policy](./installation#content-security-policy) |
| Retrying fails after the first error with a `Response` source | A `Response` can be read only once | Call `setWasmSource` again before retrying |

`setWasmSource` is ignored after the module has loaded, so call it before the first `create()`.

## The canvas stays blank

Check these in order:

1. **No `render()` call.** `render*` methods only describe the chart; `render()` draws. Call it after every change, or use `enableNodeInteractions(canvas, { autoRender: true })` for interaction updates.
2. **The canvas has no size.** With `autoResize` (the default) the pixel size follows the CSS size. A canvas inside a container with zero height stays 1 px. Give the canvas or its container a height.
3. **`autoResize: false` without sizing.** Set `canvas.width` / `height` yourself and call `sdk.resize(width, height)` and `sdk.render()`.
4. **The chart call threw.** `render*` methods validate input and throw an `Error` (for example ``renderLineChart: give `x` for every series or none``). Check the console.
5. **You read the canvas directly.** A WebGPU canvas loses its content after the frame is presented, so `canvas.toDataURL()` can return an empty image. Use `sdk.toImage()`, `sdk.toDataURL()` or `sdk.exportChartSVG()` instead: see [Export](./export).

## Labels, legend or title are in the wrong place

The overlay DOM is appended to the canvas's parent element and positioned with `position: absolute` from the canvas offset. Give the parent `position: relative` (or another positioned value) so the offsets refer to it.

## The chart is blurry on HiDPI screens

With `autoResize` the backing store is the CSS size × device pixel ratio, also after browser zoom or moving to another monitor. Blurry output usually means `autoResize: false` with `canvas.width` / `height` set to the CSS size. Multiply by `window.devicePixelRatio` and call `sdk.resize()`. The backing store is capped at 8192 px per side. `setPixelRatio(ratio)` overrides the ratio used for strokes and markers.

## Many charts on one page fail

Each `Charturbo.create(canvas)` creates its own GPU device, and browsers cap live WebGL contexts at about 16. On the WebGL2 fallback, a page with dozens of charts runs out of contexts. Create one `CharturboDevice` and pass it to every chart: see [Shared GPU Device](./shared-device).

## Zoom or hover does not update the chart

`enableNodeInteractions` changes the view but draws only when `autoRender: true` is set (default `false`). Either set it or call `sdk.render()` from your own loop. The React and Vue components use `autoRender: true` by default.

## `window is not defined` or errors during SSR

Importing Charturbo on the server is safe: no entry touches `window` or `document` at import time. The error comes from calling `Charturbo.create` on the server. Create the engine in a client-only hook (`useEffect`, `onMounted`) or use the React / Vue components, which render only the container markup on the server.

## Custom tooltip shows raw HTML or runs scripts

`formatTooltip` and `formatChartTooltip` return HTML that is inserted as is. Escape data strings with the exported `escapeHtml`:

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  formatTooltip: (d) => `<b>${escapeHtml(d.label)}</b>`,
});
```

The built-in tooltips already escape every data-derived string.

## Physics positions are out of date after `stepPhysicsAsync`

`stepPhysicsAsync` resolves when the GPU step is submitted. The CPU copy used for picking, export, node details and `isSleeping()` trails by one or two frames. `await sdk.syncPhysicsPositions()` before reading positions that must be current. Await each `stepPhysicsAsync` before starting the next; a second call while one is pending throws `A physics step is already pending`.

## See also

- [Installation & Bundlers](./installation)
- [Core Concepts](./core-concepts)
- [Performance](./performance)
