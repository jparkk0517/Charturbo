# 快速开始

本页将构建一个包含一百万个点的可交互折线图。这里假设使用 Vite 等打包工具；其他环境请参阅[安装与打包工具](./installation)。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 安装

::: warning 注意
`charturbo` 包尚未发布到 npm。在首次发布之前，请从源码构建并安装生成的 tarball，参见[从源码构建](./installation#build-from-source)。
:::

发布之后：

```bash
npm install charturbo
```

## 添加画布

SDK 在 `<canvas>` 中绘制，并为标题、图例、坐标轴标签和提示框添加 DOM 元素。这些元素会追加到画布的父元素中，并以画布的位置为基准定位，因此请用 `position: relative` 的容器包裹画布。为画布设置 CSS 尺寸后，其像素尺寸会自动跟随。

```html
<div class="chart">
  <canvas id="chart"></canvas>
</div>

<style>
  .chart { position: relative; height: 360px; }
  .chart canvas { display: block; width: 100%; height: 100%; }
</style>
```

## 绘制第一个图表

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector<HTMLCanvasElement>('#chart')!;
const sdk = await Charturbo.create(canvas);

// Float32Array 中的 1,000,000 个样本
const values = new Float32Array(1_000_000);
let walk = 0;
for (let i = 0; i < values.length; i++) {
  walk += (Math.random() - 0.5) * 0.4;
  values[i] = walk;
}

sdk.renderLineChart([{ name: '传感器 A', values }], {
  title: '遥测数据',
  axes: { x: { title: '样本', format: '.2s' }, y: { format: '.1f' } },
});
sdk.render();
```

各步骤的作用：

1. `Charturbo.create(canvas)` 加载 WebAssembly 模块（每个页面一次），并在 WebGPU 上启动引擎；WebGPU 不可用时使用 WebGL2。
2. `renderLineChart` 把数据交给引擎。没有 `x` 时，样本按索引等间距排列。
3. `render()` 绘制一帧。SDK 没有空闲时持续运行的渲染循环：修改任何内容后都要调用 `render()`。

## 添加交互

```ts
sdk.enableNodeInteractions(canvas, { autoRender: true });
```

这会开启提示框、x 轴滚轮缩放、拖拽平移和双击重置。在触屏设备上：双指缩放、拖拽平移、轻点固定提示框、长按拖动查看、双击重置。`autoRender: true` 会在每次交互后调用 `render()`；不设置时需要自己绘制帧。

该调用返回一个用于移除监听器的函数。缩放轴、框选缩放、刷选和触控选项请参阅[交互](./interactions)。

## 更新数据

```ts
// 追加一个数据块，只保留最新的 100,000 个样本
sdk.appendSeriesData(0, nextChunk, undefined, { maxPoints: 100_000 });
sdk.render();
```

`setSeriesData(seriesIndex, values, x?)` 替换一个系列，并保留样式和缩放状态。参见[实时数据流](./streaming)。

## 处理不受支持的浏览器

```ts
import { Charturbo, CharturboInitError } from 'charturbo';

if (!(await Charturbo.isSupported())) {
  showFallback(); // 既没有 WebGPU 适配器也没有 WebGL2
} else {
  try {
    const sdk = await Charturbo.create(canvas);
    // ...
  } catch (e) {
    if (e instanceof CharturboInitError) console.warn(e.reason); // 'no-webgpu' | 'adapter' | 'device' | 'wasm'
  }
}
```

## 清理

```ts
sdk.dispose(); // 移除监听器和叠加层 DOM，释放引擎
```

当图表离开页面时（路由切换、组件卸载）调用它。React 和 Vue 组件会自动完成这一步。

## 在 React 或 Vue 中使用

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={series} options={{ title: 'CPU' }} style={{ height: 300 }} />;
```

参见 [React](./react) 和 [Vue](./vue)。

## 下一步

- [核心概念](./core-concepts)：引擎生命周期、渲染与尺寸调整。
- [数据与坐标轴](./data-and-axes)：x 值、时间轴、对数刻度。
- [图表](../charts/line)：每种图表一个页面。
- [性能](./performance)：处理超大数据的技巧。
