# 实时数据流

折线图和面积图无需重建即可接收新样本：替换单个系列、以滑动窗口追加到系列末尾，或一次性追加到所有面积系列。样式、图例状态和缩放窗口都会保留。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });
const t0 = Date.now();
sdk.renderLineChart(
  [
    { name: 'p50', values: [40], x: [t0] },
    { name: 'p99', values: [95], x: [t0] },
  ],
  {
    title: '请求延迟 (ms)',
    axes: { x: { type: 'time' }, y: { min: 0, autoscale: 'visible' } },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

setInterval(() => {
  const x = Date.now();
  sdk.appendSeriesData(0, [readP50()], [x], { maxPoints: 4_000 });
  sdk.appendSeriesData(1, [readP99()], [x], { maxPoints: 4_000 });
  sdk.render(); // 一个周期的所有追加完成后渲染一次
}, 50);
```

## 更新方法

| 方法 | 返回值 | 说明 |
|---|---|---|
| `setSeriesData(series, values, x?)` | 新的样本数 | 替换单个折线 / 面积系列的数据 |
| `appendSeriesData(series, values, x?, { maxPoints }?)` | 新的样本数 | 追加到单个折线或 overlap 面积系列 |
| `appendAreaData(chunks, { maxPoints }?)` | 每个系列保留的长度 | 在一次原子调用中为每个面积系列各追加一个数据块 |

- 若图表以 `x` 渲染，则必须传入 `x`；否则不能传入。可传数字、epoch ms 或 `Date`。
- 追加的 `x` 不得早于该系列最后一个 x。
- `setSeriesData` 会以引用方式保留 `values` 供提示框和无障碍使用；之后请勿修改该数组。
- 更新后请调用 `render()`（由交互引起的帧可交给 `autoRender`）。

## 滑动窗口

`maxPoints` 只保留每个系列最新的 N 个样本。`0` 或省略表示不限制。`appendAreaData` 要求取值为 0 到 4294967295 的整数。

数据点 id 在每次更新时重新编号：索引 0 始终是保留下来的最旧样本。请勿跨更新保存 id。

## 跟随最新数据

- 未缩放的图表始终显示全部数据。
- 若缩放窗口触及右边缘，则以相同的 x 宽度跟随最新数据。
- 否则保持绝对 x 窗口不变。

新数据使可见范围移动时会触发 `'rangechange'`。

## 数据流中的 y 轴

`axes.y.autoscale` 选项决定 y 值域如何响应新数据（见[数据与坐标轴](./data-and-axes#y-domain)）：

| `autoscale` | 行为 |
|---|---|
| `'all'`（默认） | 所有保留数据的范围 |
| `'visible'` | 可见窗口的范围，带滞后更新（无抖动） |
| `'none'` | 计算一次后保持不变 |

手动 y 缩放（`setYRange`、Shift + 滚轮）会固定 y 窗口；在调用 `resetChartZoom()` 之前，数据流不会改变它。

## 面积图

```ts
// 按渲染顺序为每个系列提供一个数据块（包括隐藏的系列）
const lengths = sdk.appendAreaData(
  [
    { values: nextSearch, x: nextDays },
    { values: nextSocial, x: nextDays },
  ],
  { maxPoints: 4_000 }
);
sdk.render();
```

- `overlap` 面积图也可以逐系列使用 `setSeriesData` / `appendSeriesData`。
- `stacked` 和 `percent` 面积图必须使用 `appendAreaData` 追加：各数据块的长度和 `x` 必须相同。在这些模式下，`setSeriesData` 必须与其他系列保持相同的长度和 x。
- 整个批次会先完成校验；无效批次不会改变任何数据。
- 提示框和 CSV 读取最新的原始值，而不是堆叠值。

## 性能

- `appendSeriesData` 在引擎中为均摊 O(追加量)；下一帧只对可见窗口重新降采样。
- `stacked` 和 `percent` 面积图每次更新都会重新计算所有保留样本的累计顶部，复杂度为 O(保留样本数)。对于大型数据流，请调整批次大小和 `maxPoints`。
- SDK 不保留数据流的副本；提示框和无障碍功能从引擎读回数据。无障碍摘要和数据表每秒最多刷新 4 次。
- 将多次追加合并，每个周期只调用一次 `render()`。

## 限制

- 在 `stacked` / `percent` 面积图、独立带状图以及误差棒 / 脉冲图上，`appendSeriesData` 会抛出错误（请重新渲染这些图表）。
- 追加到带 `band` 的折线系列的样本不带区间：其提示框不显示范围，数据流之后数据表的区间列为空。改变长度的 `setSeriesData` 会移除区间。
- 其他图表通过再次调用其 render 方法进行更新。3D 图表有各自的数据流方法（`appendPointCloud3D`、`updateSurface3D`），见 [PointCloud3D · Surface3D](../charts/scientific-3d)。

## React 与 Vue

请在通过 `onReady(sdk)` 或组件 ref 的 `whenReady()` 获得的 SDK 上调用这些方法。数据流期间请保持 `data` 和 `options` prop 的引用不变：传入新引用会重新执行完整的 render 方法。

## 另请参阅

- [数据与坐标轴](./data-and-axes)
- [折线图](../charts/line) · [面积图](../charts/area)
- [性能](./performance)
- [React](./react) · [Vue](./vue)
