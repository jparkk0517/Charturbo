# 安装与打包工具

Charturbo 以 npm 包（`charturbo`）的形式发布，包含多个入口。它们的区别在于 WebAssembly 引擎模块（`charturbo_core_bg.wasm`，原始约 2.6 MB / gzip 约 1.0 MB / brotli 约 0.77 MB）如何到达浏览器。请选择与你的工具链匹配的入口。

## 包状态

::: warning 注意
`charturbo` 尚未发布到 npm。`npm install charturbo` 和 CDN 地址要等首次发布后才能使用。在此之前，请从源码构建。
:::

### 从源码构建 {#build-from-source}

需要 Node（`^22.12.0 || ^24.0.0 || >=26.0.0`）、Rust 和 `wasm-pack`。完整说明参见[开发环境](../contributing/development)。

```bash
# 在 https://github.com/jparkk0517/Charturbo 的克隆目录中
cd web
npm install
npm run wasm:build    # 带 WebGL2 回退的引擎 -> src/wasm-pkg
npm run wasm:webgpu   # 仅 WebGPU 引擎 -> src/wasm-pkg-webgpu
npm pack              # 构建 dist-lib/ 并生成 charturbo-<version>.tgz

# 在你的应用中
npm install /path/to/charturbo-<version>.tgz
```

`npm pack` 会先运行 `build:lib` 和 `build:lib:webgpu`，因此两个 WebAssembly 构建都必须存在。如果只需要默认入口，`npm run build:lib` 会把它们构建到 `web/dist-lib/`。

## 入口

| 入口 | WebAssembly | 适用场景 |
|---|---|---|
| `charturbo` | 独立文件，通过 `new URL('./charturbo_core_bg.wasm', import.meta.url)` 加载 | Vite、webpack 5、带资源处理的 Rollup / Parcel：打包工具把 `.wasm` 作为资源输出 |
| `charturbo/inline` | 以 base64 内嵌（约 3.9 MB 的 JS） | esbuild 或任何没有资源处理的环境；无需额外部署文件 |
| `charturbo/umd` | 内嵌 | `<script>` 标签（全局 `Charturbo`）和 CommonJS `require` |
| `charturbo/react`、`charturbo/vue` | 与主入口共享 | React >= 18 / Vue >= 3.3（可选 peer 依赖）；仅 ESM |
| `charturbo/webgpu`、`charturbo/inline-webgpu`、`charturbo/webgpu-umd` | 仅 WebGPU 引擎 | 参见[仅 WebGPU 构建](#webgpu-only-build) |

所有入口导出相同的 API。打包工具支持时优先使用 `charturbo`：二进制 `.wasm` 比 base64 文本更小，并且可以边下载边编译。

## 打包工具

### Vite

无需配置。`import { Charturbo } from 'charturbo'` 在 dev 和 build 中都能工作；Vite 会在 chunk 旁输出 `charturbo_core_bg.wasm`。

### webpack 5

无需配置。webpack 5 把 `new URL('...', import.meta.url)` 当作资源引用并输出 `.wasm` 文件。

### esbuild

esbuild 不会输出 `new URL(..., import.meta.url)` 资源。可选择：

- `charturbo/inline`（无需其他操作），或
- `charturbo` 加上一个把 `charturbo_core_bg.wasm` 放到服务器上的复制步骤，并用 `setWasmSource` 指向它：

```ts
import { setWasmSource, Charturbo } from 'charturbo';

setWasmSource('/assets/charturbo_core_bg.wasm');
const sdk = await Charturbo.create(canvas);
```

该文件以 `charturbo/charturbo_core_bg.wasm` 导出，可以从 `node_modules/charturbo/dist-lib/charturbo_core_bg.wasm` 复制。

### 不使用打包工具（`<script>` 标签）

UMD 构建内嵌了模块，并暴露全局 `Charturbo`（命名空间对象；类为 `Charturbo.Charturbo`）。请在自己的服务器上提供 `dist-lib/charturbo.umd.cjs`：

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

类型随包提供。支持 `moduleResolution` 为 `bundler`、`node16` / `nodenext`（ESM 和 CJS）以及 `node10`。

## 从其他位置加载模块

`setWasmSource(source)` 用于更改 WebAssembly 模块的来源，适用于 CDN、复制步骤或严格的内容安全策略。

```ts
import { setWasmSource, Charturbo } from 'charturbo';
import wasmUrl from 'charturbo/charturbo_core_bg.wasm?url'; // Vite

setWasmSource(wasmUrl);
const sdk = await Charturbo.create(canvas);
```

| 可接受的来源 | 说明 |
|---|---|
| `string`、`URL`、`Request` | 通过 fetch 获取 |
| `Response`、`Promise<Response>` | 只能使用一次：加载失败后，重试前需再次调用 `setWasmSource` |
| `BufferSource` | 模块字节 |
| `WebAssembly.Module` | 已编译的模块 |

- 在第一次 `Charturbo.create()` 或 `CharturboDevice.create()` 之前调用。模块加载完成后该调用会被忽略。
- 模块每个页面只加载一次；并发的 `create()` 调用共享同一次加载。加载失败时，下一次 `create()` 会重试。
- `charturbo/inline` 和 UMD 构建内嵌了模块，不需要设置来源。

## 内容安全策略 {#content-security-policy}

- 编译 WebAssembly 需要在 `script-src` 中包含 `'wasm-unsafe-eval'`（或 `'unsafe-eval'`）。这适用于所有入口，包括 inline 和 UMD 构建。
- 通过 fetch 获取模块时（`charturbo`，或传入 URL 的 `setWasmSource`），其来源必须被 `connect-src` 允许。inline 构建不会发起 fetch。
- 内置提示框是带有内联 `style` 属性的 HTML 字符串。如果 `style-src` 不含 `'unsafe-inline'`，这些属性会被拦截，提示框布局会失效。叠加层标签通过 DOM style API 设置样式，不受影响。

## 仅 WebGPU 构建 {#webgpu-only-build}

`charturbo/webgpu`（ES，独立的 `charturbo_core_bg-webgpu.wasm`）、`charturbo/inline-webgpu`（ES，内嵌）和 `charturbo/webgpu-umd`（UMD，内嵌）包含不带 WebGL2 回退的引擎。WebGL2 栈占默认模块的一半以上，因此该构建的下载量小得多。它导出与 `charturbo` 相同的 API 和类型。

在不支持 WebGPU 的浏览器中，该构建的 `Charturbo.create` 会以 `CharturboInitError` reject，不会回退。如果需要同时支持两者，请在运行时选择构建：

```ts
// 没有 @webgpu/types 时，DOM 类型中不包含 navigator.gpu
const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
const adapter = await gpu?.requestAdapter().catch(() => null);
const { Charturbo } = adapter ? await import('charturbo/webgpu') : await import('charturbo');
const sdk = await Charturbo.create(canvas);
```

`charturbo/react` 和 `charturbo/vue` 使用默认构建。

## 浏览器支持

| 渲染器 | 浏览器 |
|---|---|
| WebGPU | Chrome / Edge 113+，Safari 26+ |
| WebGL2（自动回退） | 其他现代浏览器 |

WebGPU 只在安全上下文（HTTPS 或 `localhost`）中可用；在普通 HTTP 下，默认构建使用 WebGL2。只要任一渲染器可用，`Charturbo.isSupported()` 就会 resolve 为 `true`。

## 服务器端渲染

在 Node 中或 SSR 期间导入任何入口都是安全的：导入时不会访问 `window` 或 `document`，`charturbo/inline` 也只在第一次启动引擎时才解码内嵌模块。请只在客户端创建引擎，例如在 `useEffect` 或 `onMounted` 中。React 和 Vue 组件已经这样处理，在服务器上只渲染 `<div><canvas></div>`。

## 另请参阅

- [快速开始](./getting-started)
- [常见问题与故障排查](./faq)
- [开发环境](../contributing/development)
