# 共享 GPU 设备

`CharturboDevice` 让多个图表共用同一个 GPU 适配器、设备和一套已编译的管线。适用于包含几十到几百个图表的页面，例如仪表盘和迷你图表格。

[在线示例](https://jparkk0517.github.io/Charturbo/sparklines.html)

## 为什么需要

`Charturbo.create(canvas)` 会为每个画布单独请求适配器和设备，并编译所有管线。浏览器还会将同时存在的 WebGL 上下文限制在 16 个左右，因此在 WebGL2 回退模式下，包含 100 个图表的页面会失败。

`CharturboDevice` 持有一个 instance、adapter、device 和 queue，以及按表面格式缓存的一套管线。其上的每个引擎只保留自己的表面配置、深度纹理、uniform 和实例缓冲区；这些缓冲区从 16 个元素起步，按需增长。

## 基本用法

```ts
import { CharturboDevice, Charturbo } from 'charturbo';

const device = await CharturboDevice.create(); // { backend: 'auto' | 'webgpu' | 'webgl2' }
const charts: Charturbo[] = [];

for (const row of rows) {
  // 无需请求适配器 / 设备，无需编译管线
  const sdk = await Charturbo.create(row.canvas, { device });
  sdk.renderSparkline(row.values, { type: 'line', showLast: true, showMinMax: true, label: row.name });
  sdk.render();
  charts.push(sdk);
}

device.engineCount; // 此设备上存活的引擎数

// 清理
for (const sdk of charts) sdk.dispose();
device.dispose();
```

与 `device` 一起使用时，`Charturbo.create` 的其他选项（`locale`、`autoResize`、`timeZone`、`sync`、`animation`）照常生效。

## API

`CharturboDevice.create(options?)` 返回 `Promise<CharturboDevice>`。

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `backend` | `'auto' \| 'webgpu' \| 'webgl2'` | `'auto'` | `'auto'`：有可用适配器时用 WebGPU，否则用 WebGL2。 |

失败时与 `Charturbo.create` 一样抛出 `CharturboInitError`（`'no-webgpu'`、`'adapter'`、`'device'`、`'wasm'`）。

| 成员 | 类型 | 说明 |
|---|---|---|
| `backend` | `'webgpu' \| 'webgl2'` | 此设备上所有引擎使用的后端。 |
| `engineCount` | `number` | 此设备上当前存活的引擎数（`dispose()` 后为 `0`）。 |
| `pipelineSets` | `number` | 已编译的管线套数：与引擎数量无关，每种表面格式一套。 |
| `disposed` | `boolean` | 已调用 `dispose()`，不能再创建新引擎。 |
| `dispose()` | `void` | 释放此句柄。 |

## 后端

- **WebGPU**：每个画布都有自己的 `GPUCanvasContext`，并以共享设备配置。N 个画布 = N 个表面 + 1 个设备。
- **WebGL2 回退**：GL 上下文只能呈现到自己的画布。设备将每个引擎渲染到一个隐藏的共享画布上（尺寸不同时按该引擎的尺寸重新配置），并在同一任务内用 2D `drawImage` 复制到引擎的画布。一个 WebGL 上下文即可服务任意数量的画布。

::: warning 注意
在 WebGL2 路径下，引擎画布使用 `2d` 上下文。请传入新的画布：已有 `webgl2` 或 `webgpu` 上下文的画布无法挂接。尺寸不一的画布混用时，每帧都要重新配置共享画布，因此尽量保持尺寸一致。
:::

## 生命周期

- 引擎会让设备保持存活。释放最后一个引擎后，设备仍会保留以供新引擎使用。
- `device.dispose()` 释放句柄。仍存活的引擎继续工作，待它们也全部释放后 GPU 设备才会被释放。之后调用 `Charturbo.create(canvas, { device })` 会抛出 `CharturboDevice is disposed`。
- 在设备上创建的引擎，图的默认节点数和边数为 0（不带 `device` 的 `Charturbo.create` 默认为 1000 / 2000）。
- 模块初始化与 `Charturbo.create` 共用同一个 Promise：并发调用时 WebAssembly 只实例化一次。

## 在 React 与 Vue 中

通过 `createOptions` 传入设备（仅在挂载时读取一次）。迷你图还需传入 `interactions={false}`：

```tsx
<CharturboChart type="sparkline" data={values} options={{ label: '营收' }} createOptions={{ device }} interactions={false} />
```

参见 [React](./react) 和 [Vue](./vue)。

## 性能

在无头 Chrome 中以 120 × 30 的迷你图测得：

| 场景 | 创建 + 首次渲染 |
|---|---|
| 100 个迷你图，WebGPU | 165 ms |
| 100 个迷你图，WebGL2 | 717 ms |
| 200 个迷你图，WebGPU | 234 ms |

所有场景都只有 1 套管线、0 个覆盖层 DOM。每个引擎的 CPU 内存约 67 KB，GPU 初始分配约 73 KB（240 × 60 backing store，含 57 KB 深度纹理），而默认引擎约为 813 KB。

## 另请参阅

- [迷你图](../charts/sparkline)
- [性能](./performance)
- [安装与打包工具](./installation)
