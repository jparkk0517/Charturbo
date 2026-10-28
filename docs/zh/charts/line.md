# 折线图

由 Rust 引擎在 GPU 上绘制的多系列折线图。引擎按屏幕分辨率对每个系列降采样（M4，保留尖峰），因此 1,000,000+ 个点的图表也能保持 60 FPS。适用于连续系列：传感器数据、指标、价格、时间序列。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const values = Float32Array.from({ length: 50_000 }, (_, i) => Math.sin(i * 0.05) * 40);
sdk.renderLineChart([{ name: '传感器', values }], {
  title: '传感器数据',
  axes: { x: { title: '样本' }, y: { title: '数值' } },
});
sdk.enableNodeInteractions(canvas, { autoRender: true }); // 悬停、滚轮缩放、拖动平移
sdk.render();
```

```ts
renderLineChart(
  seriesList: LineSeriesDescriptor[],
  options?: LineChartOptions
): { totalPoints: number; seriesCount: number }
```

数据点 id 为系列偏移量加上样本索引。

## 数据格式 {#data-format}

每个系列是一个 `LineSeriesDescriptor`。`values` 接受 `Float32Array`（大数据量时推荐）或 `number[]`。`NaN`、`null` 和 `undefined` 视为缺失样本（见 `nulls`）。

`x` 可选。要么为每个系列都提供，要么都不提供：

- 不提供 `x` 时，样本按索引等间距排列，并以 `xLabelPrefix` 作为标签（`T+120`）。
- 提供 `x` 时，每个值都有自己的 x（`Float64Array`、`number[]` 或 `Date[]`，长度与 `values` 相同）。这些值必须有限且升序（允许相等值），否则调用会抛出异常。间距可以不规则，各系列长度也可以不同。
- `Date[]` 默认选用时间轴。毫秒时间戳数字需要设置 `axes.x.type: 'time'`。

```ts
sdk.renderLineChart(
  [
    { name: 'CPU', values: cpu, x: timestamps },      // Date[] 或毫秒时间戳
    { name: 'GPU', values: gpu, x: otherTimestamps }, // 长度和间距不同也可以
  ],
  { axes: { x: { type: 'time' } }, locale: 'en-US' }
);
```

### 系列字段

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `name` | `string` | — | 图例和提示框中的名称。 |
| `values` | `Float32Array \| number[]` | — | 样本值。`NaN` / `null` / `undefined` 视为缺失。 |
| `x` | `Float64Array \| number[] \| Date[]` | — | 每个样本的 x（见上文）。 |
| `color` | `ColorInput` | 主题调色板 | 0..1 范围的 `[r, g, b, a]` 或 CSS 颜色字符串。 |
| `lineWidth` | `number` | 图表的 `lineWidth` | 该系列的线宽，单位为 CSS px。 |
| `yAxis` | `'left' \| 'right'` | `'left'` | `'right'` 启用第二个 y 轴（`axes.y2`）。仅限 2D 折线图。 |
| `marker` | `LineMarkerOptions \| boolean` | — | 数据点标记。`true` 使用默认值。见[线条样式](#line-styles)。 |
| `dash` | `number[]` | 实线 | 虚线模式，单位为 CSS px，例如 `[6, 3]`。 |
| `curve` | `'linear' \| 'step' \| 'stepBefore' \| 'stepAfter' \| 'monotone'` | `'linear'` | 样本之间的插值方式。 |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | 图表的 `nulls` | 该系列的缺失样本处理策略。 |
| `band` | `{ lower, upper, opacity? }` | — | 在线条下方填充的范围带。见[范围带](#range-band)。 |
| `pieces` | `LinePiece[]` | — | 按数值区间分段着色。见[分段着色](#piecewise-colors)。 |
| `piecesBy` | `'y' \| 'x'` | `'y'` | 用于判断区间的值。 |
| `pointSize` | `number` | — | 已弃用。映射为 `marker: { size }`。 |

## 选项 {#options}

`LineChartOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | `string` | — | 绘图区上方的图表标题。 |
| `description` | `string` | — | canvas 的无障碍名称。替代自动摘要，自动摘要随之移到描述中。 |
| `viewMode` | `'2d' \| '2.5d'` | `'2d'` | 平面 2D 图表或 2.5D 透视视图。 |
| `lineWidth` | `number` | `2` | 所有系列的线宽，单位为 CSS px。任何缩放级别下保持不变。 |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | `'gap'` | 缺失样本：断开线条、连接相邻点，或按 0 绘制。系列的 `nulls` 优先。 |
| `axes` | `{ x?: LineXAxisOptions; y?: LineYAxisOptions; y2?: LineYAxisOptions }` | — | 坐标轴标题、格式、刻度类型、y 值域。仅当某个系列设置了 `yAxis: 'right'` 时才使用 `y2`。见[数据与坐标轴](../guide/data-and-axes)。 |
| `legend` | `ChartLegendOptions \| boolean` | 2 个及以上系列时显示 | `{ show, toggle, emphasize, position, overflow }`。点击切换系列显示，悬停时淡化其他系列。见[样式与主题](../guide/styling)。 |
| `hover` | `ChartHoverStyle` | — | 十字准线和悬停标记。见[提示框与悬停](../guide/tooltips)。 |
| `showBackdropGrid` | `boolean` | `true` | 水平网格线和基线。 |
| `grid` | `ChartGridStyle` | — | 网格行数、颜色、线宽。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距，单位为 CSS px。未指定的边会根据标题、图例和坐标轴自动适配。 |
| `xLabelPrefix` | `string` | `'T'` | 系列没有 `x` 时 x 标签的前缀（`T+120`）。 |
| `locale` | `string` | SDK 区域设置 | 数字 / 时间标签和提示框数值的区域设置。 |
| `timeZone` | `CharturboTimeZone` | SDK 时区，否则为 `'local'` | 时间 x 轴的时区。 |
| `navigator` | `boolean \| { height?: number }` | 关闭 | 绘图区下方的范围选择条（仅限 2D）。高度单位为 CSS px，默认 48。 |
| `animation` | `ChartAnimationInput` | SDK 设置 | 进入 / 更新动画。见[动画](../guide/animation)。 |
| `width` | `number` | `168` | 绘图区的世界坐标宽度（决定宽高比）。 |
| `height` | `number` | `86` | 绘图区的世界坐标高度。 |

## 线条样式 {#line-styles}

```ts
sdk.renderLineChart(
  [
    { name: '预测', values: forecast, curve: 'monotone', dash: [6, 3],
      band: { lower: lo, upper: hi, opacity: 0.2 } },
    { name: '实际', values: actual, marker: { shape: 'diamond', size: 8, show: 'auto' } },
    { name: '比率', values: rate, curve: 'stepAfter', nulls: 'connect' },
  ],
  { nulls: 'gap' } // 图表默认值；系列的 `nulls` 优先
);
```

`marker`（`LineMarkerOptions`）：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `shape` | `'circle' \| 'square' \| 'diamond' \| 'triangle' \| 'none'` | `'circle'` | `'none'` 关闭标记。 |
| `size` | `number` | `6` | 直径，单位为 CSS px。 |
| `fill` | `ColorInput` | 系列颜色 | 标记填充色。 |
| `stroke` | `ColorInput` | 图表表面颜色 | 用于分隔的描边。 |
| `strokeWidth` | `number` | `1` | 描边宽度，单位为 CSS px。 |
| `show` | `'auto' \| 'always' \| 'never'` | `'auto'` | `'auto'` 仅在降采样后可见点之间的间距至少为 8 CSS px 时显示标记，因此放大后标记会显现。 |

- `dash`：`[on, off]` 或 `[on, off, on, off]`，单位为 CSS px。`[a]` 表示 `[a, a]`；给出 3 个值时只使用前 2 个。引擎沿折线计算虚线相位，因此虚线会跨线段连续延续。
- `curve`：`'step'` 在中点处阶跃，`'stepBefore'` / `'stepAfter'` 在样本处阶跃，`'monotone'` 为 Fritsch–Carlson 单调三次插值（无过冲）。曲线在降采样之后应用。
- `nulls`：`'gap'` 断开线条。`'connect'` 连接相邻点。`'zero'` 将该样本按 0 绘制（此时数值轴会包含 0）。

## 范围带 {#range-band}

`band` 以系列颜色在线条下方填充一个范围（置信区间、最小–最大包络）。

- `lower` / `upper` 每个样本一个值（`NaN` = 缺失）。`opacity` 与系列颜色的 alpha 相乘（默认 `0.2`）。
- 范围带的 LOD 在每个像素列中保留最小的下边缘和最大的上边缘，因此在 1M 个点时极值依然保留。数值轴会包含范围带。
- 范围带与系列共用同一个图例项。提示框显示 `value lower – upper`（`item.band`）。数据表和 CSV 会增加 `<name> lower` 和 `<name> upper` 列。
- 仅限折线图：面积图会忽略 `band`。如需不带中心线的范围带，请使用[带状图 · 范围图](./band)。
- 通过 `appendSeriesData` 追加的样本没有范围带。以新长度调用 `setSeriesData` 会移除范围带。

## 分段着色 {#piecewise-colors}

```ts
sdk.renderLineChart(
  [
    {
      name: 'AQI',
      values: aqi,
      x,
      pieces: [
        { lte: 50, color: '#2e9e4f' },
        { gt: 50, lte: 100, color: '#e0b100' },
        { gt: 100, lte: 150, color: '#f07c1e' },
        { gt: 150, color: '#d93434' },
      ],
    },
  ],
  { axes: { x: { type: 'time' } } }
);
```

与 ECharts 分段型 `visualMap` 类似，`pieces` 按数值区间为系列着色。每个 `LinePiece` 为 `{ gt?, gte?, lt?, lte?, color }`；省略某个边界则该端开放。

- 默认判断 y 值。设置 `piecesBy: 'x'` 时判断数据 x（时间轴上为 epoch ms），系列没有 `x` 时判断样本索引。
- 值取包含它的第一个区间的颜色。不在任何区间内的值使用系列颜色。
- 同时给出时，`gte` 优先于 `gt`，`lte` 优先于 `lt`，与 ECharts 相同。
- 线条在绘制路径（降采样和 `curve` 之后）穿过边界处按线性插值切分，因此颜色恰好在边界值处改变。虚线模式在切分处保持连续。
- 面积填充被裁剪为边界之间的条带。y 区间时为按高度划分的水平条带，类似 ECharts 渐变；堆叠面积按堆叠后的高度判断。见[面积图](./area)。
- 标记（设置了 `marker.fill` 时除外）、悬停标记、提示框色块和 SVG 导出使用区间颜色。
- 支持缩放、流式数据、对数与反向坐标轴以及右侧 y 轴。
- 不使用区间颜色的部分：范围 `band`、独立的[带状图](./band) / [误差棒 · 脉冲图](./errorbar-impulse)、[组合图](./combo)、图例色块和数据表。
- `pieces` 不是数组、区间缺少 `color`、边界为 `NaN`，或 `piecesBy` 不是 `'y'` / `'x'` 时抛出异常。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html#12-pieces)

## 更新数据 {#updating-data}

```ts
sdk.setSeriesData(0, values, x);                                // 替换一个系列
sdk.appendSeriesData(0, chunk, chunkX, { maxPoints: 100_000 }); // 追加，丢弃最旧的数据
sdk.render();
```

| 方法 | 说明 |
|---|---|
| `setSeriesData(seriesIndex, values, x?)` | 替换一个系列。保留样式、图例状态和缩放。返回新的样本数。仅当图表渲染时提供了 `x` 才需要传入 `x`。 |
| `appendSeriesData(seriesIndex, values, x?, options?)` | 追加样本。新的 `x` 不得小于该系列最后一个 x。`maxPoints` 只保留最新的样本。返回新的样本数。 |
| `setLineWidth(widthPx, seriesIndex?)` | 修改所有系列或某一个系列的线宽。 |
| `setSeriesVisible(seriesIndex, visible)` | 与点击图例相同。 |
| `emphasizeSeries(seriesIndex \| null)` | 淡化其他系列；`null` 取消淡化。 |

每次更新后数据点 id 都会重新计算。当缩放窗口贴着右边缘时，它会跟随新数据移动。见[实时数据流](../guide/streaming)。

## Y 值域与坐标轴 {#y-domain-and-axes}

```ts
sdk.renderLineChart(series, { axes: { y: { min: 0, autoscale: 'visible', nice: true } } });
sdk.setYDomain({ autoscale: 'all' }); // 合并到当前选项中
sdk.getYDomain();                     // [min, max]
```

- `autoscale`：`'all'`（默认，完整数据范围）、`'visible'`（缩放窗口内的可见系列）、`'none'`（计算一次后保持不变）。
- `scale: 'log'`、`reverse` 和 `tickCount` 适用于 `axes.x`、`axes.y` 和 `axes.y2`。对数 x 轴需要正的数值 `x`。
- 设置了 `yAxis: 'right'` 的系列会增加一个拥有独立值域的右侧坐标轴，使用 `setY2Domain` / `getY2Domain` 控制。请谨慎使用双坐标轴：两个范围的选取可能制造出虚假的交叉。

详见[数据与坐标轴](../guide/data-and-axes)。

## 交互 {#interactions}

调用 `enableNodeInteractions(canvas)` 之后：

- 滚轮缩放 x 轴，拖动平移，双击重置。触摸操作：单指平移、双指缩放、点按固定提示框、长按拖动查看数据。
- `hover.mode: 'index'`（默认）显示悬停 x 处的所有系列；`'nearest'` 只显示最近的点。
- 编程方式：`zoomChartX(factor, anchorNdcX?)`、`setXRange(min, max)`、`resetChartZoom()`。
- 2D 下支持刷选、导航条和标注。

见[交互](../guide/interactions)、[提示框与悬停](../guide/tooltips)和[标注](../guide/annotations)。

## 注意事项 {#notes}

- 2.5D 视图始终使用 `'nearest'` 悬停。虚线相位和单调曲线细分在该视图下是近似值。右侧 y 轴、导航条和刷选仅限 2D。
- 虚线系列和标记绘制在实线系列之上的图层中，与强调顺序无关。
- `renderLineChart` 为提示框和无障碍功能按引用保留 `values`：之后不要修改它。

## 另请参阅 {#see-also}

- [面积图](./area)
- [带状图 · 范围图](./band)
- [误差棒 · 脉冲图](./errorbar-impulse)
- [组合图](./combo)
- [实时数据流](../guide/streaming)
- [性能](../guide/performance)
