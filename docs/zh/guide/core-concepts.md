# 核心概念

本页说明 `Charturbo` 实例的工作方式：如何创建、何时绘制、如何跟随画布尺寸以及如何释放。在构建比单个静态图表更复杂的内容之前，请先通读一遍。

## 一个画布对应一个 SDK

一个 `Charturbo` 实例拥有一个绑定到某个 `<canvas>` 的引擎。它一次只显示一个视图：图表、3D 图或嵌入向量点云，或 3D 场景。

- 每次 `render*` 调用（`renderLineChart`、`renderBarChart` 等）都会替换该实例当前的图表。
- 要并排显示两个图表，请创建两个画布和两个实例。
- 对于图表很多的页面，用 `Charturbo.create(canvas, { device })` 让实例共享一个 GPU 设备，参见[共享 GPU 设备](./shared-device)。

## 创建实例

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { locale: 'en-US', autoResize: true });
```

`Charturbo.create(canvas, options?)` 加载 WebAssembly 模块（每个页面一次），在 WebGPU 或 WebGL2 上启动引擎，并 resolve 为实例。

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `autoResize` | `boolean` | `true` | 让 `canvas.width` / `height` 保持为 CSS 尺寸 × 设备像素比，变化时调用 `resize()` + `render()` |
| `locale` | `string` | 页面语言（`<html lang>`），其次为浏览器语言 | 数字 / 日期标签、提示框数值和内置 UI 文本的区域设置（参见[国际化](./i18n)） |
| `timeZone` | `CharturboTimeZone` | `'local'` | 时间轴、标签和提示框的时区：`'local'`、`'UTC'` 或 IANA 名称 |
| `sync` | `ChartSyncMemberOptions` | 无 | 加入光标 / 缩放联动组（参见[仪表盘联动](./dashboard-sync)） |
| `animation` | `ChartAnimationInput` | 关闭 | 进入 / 更新动画（参见[动画](./animation)） |
| `device` | `CharturboDevice` | 无 | 共享 GPU 设备：不请求适配器 / 设备，复用已缓存的管线 |
| `seed` | `number` | `42` | 生成的初始图的随机种子 |
| `nodeCount` | `number` | `1000`（使用 `device` 时为 `0`） | 生成的初始图的节点数 |
| `edgeCount` | `number` | `2000`（使用 `device` 时为 `0`） | 生成的初始图的边数 |
| `clusterCount` | `number` | `8`（使用 `device` 时为 `1`） | 生成的初始图的簇数 |

最后四个选项只对图视图有意义：引擎启动时带有一个由种子生成的随机图，在你渲染图表或加载自己的数据（`loadDataset`、`loadEmbeddings`）之前显示它。只用图表的应用可以忽略这些选项。

`create` 会以 `CharturboInitError` reject，其 `reason` 说明失败原因：

| `reason` | 含义 |
|---|---|
| `'no-webgpu'` | WebGPU 和 WebGL2 都不可用，或无法创建画布表面 |
| `'adapter'` | 没有合适的 GPU 适配器 |
| `'device'` | 适配器拒绝创建设备 |
| `'wasm'` | WebAssembly 模块加载失败 |

可以先用 `Charturbo.isSupported()` 检查 WebGPU 适配器或 WebGL2 是否可用。即便如此，`create` 仍可能因设备层面的错误而失败。

## 渲染

SDK 把*描述*图表和*绘制*帧分开：

- `render*` 方法和 setter（`setSeriesData`、`setTheme`、`setXRange` 等）修改引擎状态。
- `render()` 绘制一帧并更新叠加层 DOM。

没有空闲时持续运行的渲染循环。修改任何内容后请调用 `render()`：

```ts
sdk.renderLineChart(series, { title: '吞吐量' });
sdk.render();

sdk.appendSeriesData(0, chunk);
sdk.render();
```

以下情况由 SDK 代为调用 `render()`：

| 触发方式 | 时机 |
|---|---|
| `autoResize` | 画布像素尺寸变化后 |
| `enableNodeInteractions(canvas, { autoRender: true })` | 悬停、缩放、平移、点击图例等交互之后（`autoRender` 默认为 `false`） |
| 动画 | 进入 / 更新动画运行期间每帧调用，结束后停止 |
| React / Vue 组件 | prop 变化后；交互默认使用 `autoRender: true` |

图物理模拟（`stepPhysics`、`stepPhysicsAsync`）不会自行渲染。请在自己的 `requestAnimationFrame` 循环中驱动它，并在每一步之后调用 `render()`。

## 替换与更新图表

再次调用 `render*` 方法会替换图表：重建叠加层 DOM、重置标注，缩放历史从空开始。每个 `render*` 方法都会返回一个简要结果，例如折线图返回 `{ totalPoints, seriesCount }`。

如果只想更新数据而不替换图表（保留样式和缩放状态），请使用该图表类型的更新方法，例如折线图和面积图的 `setSeriesData`、`appendSeriesData` 和 `appendAreaData`。参见[实时数据流](./streaming)和各图表页面。

`loadDataset` 和 `loadEmbeddings` 会把实例从图表切换到图视图，并移除图表叠加层。

## 尺寸与像素比

`autoResize: true`（默认）时，SDK 会监听画布：

- 浏览器支持时使用带 `device-pixel-content-box` 的 `ResizeObserver`，否则使用 CSS 尺寸 × `devicePixelRatio`。CSS 尺寸不变的浏览器缩放和显示器切换由 `matchMedia` 查询捕获。
- 设置 `canvas.width` / `height`，然后调用 `resize(width, height)` 和 `render()`。每边尺寸上限为 8192 px（保持宽高比）。
- 没有 CSS 尺寸的画布会在每次调整时不断变大；第一次出现这种情况时，SDK 会固定其 CSS 尺寸。

如果应用自行管理画布尺寸，请关闭该选项并告知尺寸：

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

`resize(width, height)` 使用物理像素，并触发 `'resize'` 事件。引擎在 `resize()` 时根据画布推算线条使用的像素比；`setPixelRatio(ratio)` 可以覆盖它。

叠加层（标题、图例、坐标轴标签）会追加到画布的父元素中，并以画布位置为基准定位。请把画布放在 `position: relative` 的容器中。

## 生命周期

```ts
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });
// ...
detach();      // 只移除这些监听器和提示框
sdk.dispose(); // 释放全部资源
```

`dispose()` 会：

- 退出联动组并停止自动尺寸监听，
- 停止正在运行的动画并移除所有事件处理函数，
- 解除所有 `enableNodeInteractions` 绑定，
- 移除叠加层 DOM 和无障碍元素，
- 释放 WebAssembly 引擎。

重复调用是安全的。释放后不要再使用该实例；`stepPhysicsAsync` 等方法会抛出 `Engine is disposed`。React 和 Vue 组件在卸载时会释放其引擎。

## 主题

默认主题为 `'dark'`。`setTheme` 接受 `'dark'`、`'light'` 或主题对象；`getTheme()` 返回当前主题，`CHARTURBO_THEMES` 包含内置主题。

```ts
sdk.setTheme('light');
sdk.setTheme({ ...sdk.getTheme(), name: 'brand', palette: ['#3182f6', '#14b8a6', '#f59e0b'] });
sdk.render();
```

`setTheme` 会更新背景、文本、网格、提示框以及随主题变化的图表样式。直接传给系列的颜色会保留，直到再次调用 `render*` 方法。参见[样式与主题](./styling)。

## 事件

`sdk.on(event, handler)` 订阅事件并返回取消订阅函数；也可以使用 `sdk.off(event, handler)`。

| 事件 | 负载 | 触发时机 |
|---|---|---|
| `hover` | `CharturboHoverEvent` | 悬停目标变化（需要 `enableNodeInteractions`） |
| `click` | `CharturboClickEvent` | 未拖动的点击或轻点（需要 `enableNodeInteractions`） |
| `rangechange` | `CharturboRange` | 可见范围变化（缩放、平移、重置、`setXRange`），每帧最多一次 |
| `legendtoggle` | `{ series, visible }` | 显示或隐藏某个系列 |
| `select` | `CharturboSelection` | 刷选被确认或清除 |
| `drill` | `CharturboDrillEvent` | 矩形树图 / 旭日图向下钻取或返回上层 |
| `themechange` | `CharturboTheme` | 主题变化 |
| `resize` | `{ width, height }` | 渲染目标尺寸变化（物理 px） |

```ts
const off = sdk.on('rangechange', ({ xMin, xMax }) => console.log(xMin, xMax));
off();
```

## 区域设置与时区

`locale`（create 选项或 `sdk.setLocale`）决定 `Intl` 数字和日期格式，以及内置 UI 文本的语言：无障碍摘要、数据表表头、提示框字段标签、导出和图例文本。内置英语、韩语和简体中文；其他区域设置回退到英语。未设置区域设置时，先使用页面语言（`<html lang>`），再使用浏览器语言。各图表可以用自己的 `locale` 选项覆盖。`timeZone`（或 `sdk.setTimeZone`）设置时间轴的时区。参见[国际化](./i18n)和[数字与日期格式](./number-format)。

## 另请参阅

- [快速开始](./getting-started)
- [交互](./interactions)
- [性能](./performance)
