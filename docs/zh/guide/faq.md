# 常见问题与故障排查

常见配置问题的解答。每一项都列出现象、原因和解决方法。

## `Charturbo.create` 被 reject

`create` 会抛出 `CharturboInitError`。请检查 `error.reason`：

| `reason` | 原因 | 处理方法 |
|---|---|---|
| `'no-webgpu'` | WebGPU 和 WebGL2 都不可用，或无法创建画布表面 | 显示替代内容。创建前先用 `Charturbo.isSupported()` 检查。使用共享的 WebGL2 设备时，请使用尚未创建上下文的画布 |
| `'adapter'` | 没有合适的 GPU 适配器 | 通常是 GPU 驱动被屏蔽或缺失。在不支持 WebGPU 的浏览器中使用仅 WebGPU 构建时也会得到此值 |
| `'device'` | 适配器拒绝创建设备 | 稍后重试或显示替代内容 |
| `'wasm'` | WebAssembly 模块加载失败 | 参见 [WebAssembly 模块无法加载](#wasm-load) |

```ts
try {
  sdk = await Charturbo.create(canvas);
} catch (e) {
  if (e instanceof CharturboInitError) showFallback(e.reason);
  else throw e;
}
```

## 没有使用 WebGPU

没有 WebGPU 适配器时，默认构建会静默回退到 WebGL2。常见原因：

- 页面不是安全上下文。WebGPU 只在 HTTPS 和 `localhost` 中可用。
- 浏览器尚不支持 WebGPU。WebGPU 需要 Chrome / Edge 113+ 或 Safari 26+。
- 浏览器把该 GPU 或驱动列入了屏蔽列表。

共享设备所用的后端可通过 `CharturboDevice.backend`（`'webgpu'` 或 `'webgl2'`）查看。在 WebGL2 上所有功能都可用，但 `stepPhysicsAsync` 在 CPU 上运行，WebAssembly 内存峰值也更高。

## WebAssembly 模块无法加载 {#wasm-load}

`charturbo` 入口从 JavaScript chunk 旁边的 URL fetch `charturbo_core_bg.wasm`。错误是 reason 为 `'wasm'` 的 `CharturboInitError`，消息以 `Failed to load the WebAssembly module:` 开头。

| 现象 | 原因 | 解决方法 |
|---|---|---|
| 消息中包含 `failed to fetch Wasm: 404` | 打包工具没有输出 `.wasm` 文件，或服务器没有提供该文件 | 使用 Vite 或 webpack 5，或添加复制步骤并调用 `setWasmSource(url)`，或改用 `charturbo/inline` |
| 控制台警告服务器 `does not serve Wasm with application/wasm MIME type` | `Content-Type` 不正确 | 以 `application/wasm` 提供 `.wasm`。仍能加载，但更慢 |
| 控制台出现 CSP 违规后加载失败 | `script-src` 阻止了 WebAssembly 编译，或 `connect-src` 阻止了 fetch | 参见[内容安全策略](./installation#content-security-policy) |
| 使用 `Response` 来源首次出错后，重试也失败 | `Response` 只能读取一次 | 重试前再次调用 `setWasmSource` |

模块加载完成后 `setWasmSource` 会被忽略，因此请在第一次 `create()` 之前调用。

## 画布一片空白

按以下顺序检查：

1. **没有调用 `render()`。** `render*` 方法只描述图表，真正绘制的是 `render()`。每次修改后调用它，或对交互更新使用 `enableNodeInteractions(canvas, { autoRender: true })`。
2. **画布没有尺寸。** 在 `autoResize`（默认）下，像素尺寸跟随 CSS 尺寸。位于高度为 0 的容器中的画布会保持 1 px。请为画布或其容器设置高度。
3. **`autoResize: false` 但没有设置尺寸。** 自行设置 `canvas.width` / `height`，并调用 `sdk.resize(width, height)` 和 `sdk.render()`。
4. **图表调用抛出了异常。** `render*` 方法会校验输入并抛出 `Error`（例如 ``renderLineChart: give `x` for every series or none``）。请查看控制台。
5. **直接读取了画布。** WebGPU 画布在帧呈现后内容会被清除，因此 `canvas.toDataURL()` 可能返回空白图像。请改用 `sdk.toImage()`、`sdk.toDataURL()` 或 `sdk.exportChartSVG()`，参见[导出](./export)。

## 标签、图例或标题位置错位

叠加层 DOM 会追加到画布的父元素中，并以画布位置为基准用 `position: absolute` 定位。请为父元素设置 `position: relative`（或其他定位值），使偏移以它为参照。

## 图表在高 DPI 屏幕上模糊

在 `autoResize` 下，后备缓冲区为 CSS 尺寸 × 设备像素比，浏览器缩放或切换显示器后也是如此。出现模糊通常是因为 `autoResize: false`，且 `canvas.width` / `height` 被设为 CSS 尺寸。请乘以 `window.devicePixelRatio` 并调用 `sdk.resize()`。后备缓冲区每边上限为 8192 px。`setPixelRatio(ratio)` 可覆盖线条和标记使用的像素比。

## 页面上图表很多时失败

每次 `Charturbo.create(canvas)` 都会创建自己的 GPU 设备，而浏览器把同时存在的 WebGL 上下文限制在 16 个左右。在 WebGL2 回退模式下，包含几十个图表的页面会耗尽上下文。请创建一个 `CharturboDevice` 并传给所有图表，参见[共享 GPU 设备](./shared-device)。

## 缩放或悬停没有反映到画面上

`enableNodeInteractions` 会改变视图，但只有设置 `autoRender: true`（默认 `false`）时才会绘制。请设置该选项，或在自己的循环中调用 `sdk.render()`。React 和 Vue 组件默认使用 `autoRender: true`。

## SSR 期间出现 `window is not defined` 等错误

在服务器上导入 Charturbo 是安全的：没有任何入口会在导入时访问 `window` 或 `document`。该错误来自在服务器上调用 `Charturbo.create`。请在仅客户端执行的钩子（`useEffect`、`onMounted`）中创建引擎，或使用在服务器上只渲染容器标记的 React / Vue 组件。

## 自定义提示框显示原始 HTML 或执行了脚本

`formatTooltip` 和 `formatChartTooltip` 返回的 HTML 会原样插入。请用导出的 `escapeHtml` 转义数据字符串：

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  formatTooltip: (d) => `<b>${escapeHtml(d.label)}</b>`,
});
```

内置提示框已经对所有来自数据的字符串进行了转义。

## `stepPhysicsAsync` 之后物理位置不是最新的

`stepPhysicsAsync` 在 GPU 步进提交后即 resolve。用于拾取、导出、节点详情和 `isSleeping()` 的 CPU 副本会落后一到两帧。需要最新位置时，请先 `await sdk.syncPhysicsPositions()`。请等待每次 `stepPhysicsAsync` 完成后再开始下一次；在等待期间再次调用会抛出 `A physics step is already pending`。

## 另请参阅

- [安装与打包工具](./installation)
- [核心概念](./core-concepts)
- [性能](./performance)
