# 散点图 · 气泡图

2D 散点图为每个点绘制一个 GPU 实例；点只上传一次，因此 1,000,000+ 个点也能保持 60 FPS。为每个点指定大小即可变为气泡图。用于展示两个变量之间的关系或聚类的形状。

[在线示例](https://jparkk0517.github.io/Charturbo/scatter.html)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderScatterChart(
  { x: xs, y: ys, clusters: seriesIds },
  {
    title: '细分群体分布',
    seriesNames: ['A', 'B', 'C'],
    axes: { x: { title: 'x' }, y: { title: 'y' } },
    pointRadius: 3,
    opacity: 0.85,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true }); // 滚轮：x/y 缩放，拖动：平移
sdk.render();
```

```ts
renderScatterChart(
  data: ScatterChartData,
  options?: ScatterChartOptions
): { pointCount: number; trendlines: ScatterTrendlineFit[] }
```

数据点 id = 点的索引。`trendlines` 保存 `trendline` 选项的拟合结果（未设置时为空数组），见[趋势线](#trendlines)。

## 数据格式 {#data-format}

`ScatterChartData` 由若干并行数组组成，每个点对应一项：

| 字段 | 类型 | 说明 |
|---|---|---|
| `x` | `Float32Array \| number[]` | x 坐标。 |
| `y` | `Float32Array \| number[]` | y 坐标。 |
| `sizes` | `Float32Array \| number[]` | 可选，每个点的半径，单位为 CSS px（气泡图）。默认：`pointRadius`。 |
| `clusters` | `Uint16Array \| number[]` | 可选，每个点的系列 id：对应图例项、调色板颜色、可见性切换。 |
| `colors` | `Float32Array \| number[]` | 可选，每个点的 RGBA（`4 * N` 个值，0..1）。覆盖系列颜色。 |
| `z` | `Float32Array \| number[]` | 已弃用且会被忽略：该图表为 2D。 |

系列 id 是 `seriesNames` 和 `seriesColors` 的索引。

### 气泡图

```ts
sdk.renderScatterChart(
  { x: gdp, y: lifeExpectancy, sizes: radiusPx, clusters: region },
  {
    seriesNames: ['非洲', '美洲', '亚洲', '欧洲'],
    opacity: 0.7,
    axes: { x: { title: '人均 GDP', scale: 'log', format: '$,.0f' }, y: { title: '年' } },
  }
);
```

提供 `sizes` 时，默认每个点会带有一圈 1 px 的表面颜色描边（`pointRing`），因此重叠的气泡依然清晰可辨。

## 选项 {#options}

`ScatterChartOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | `string` | — | 图表标题。 |
| `description` | `string` | — | canvas 的无障碍名称。 |
| `seriesNames` | `string[]` | `Series <id>` | 每个系列 id 在图例和提示框中的名称。 |
| `seriesColors` | `ColorInput[]` | 主题调色板，循环使用 | 每个系列 id 的颜色。 |
| `pointRadius` | `number` | `3` | 未提供 `sizes` 时的点半径，单位为 CSS px。 |
| `opacity` | `number` | `0.85` | 填充 alpha 系数。较低的值能显现密度。 |
| `pointRing` | `number` | 有 `sizes` 时为 `1`，否则为 `0` | 每个点周围表面颜色描边的宽度，单位为 CSS px。 |
| `symbol` | `'circle' \| 'square' \| 'diamond' \| 'triangle'` | `'circle'` | 所有系列的点符号。见[符号](#symbols)。 |
| `seriesSymbols` | `(ScatterSymbol \| undefined)[]` | — | 每个系列 id 的符号。缺失项使用 `symbol`。 |
| `ripple` | `ScatterRippleOptions \| boolean` | 关闭 | 在所选系列的点周围显示涟漪。`true` = 所有系列，使用默认值。见[涟漪效果](#ripple-effect)。 |
| `jitter` | `{ x?: number; y?: number; seed?: number }` | 关闭 | 用以数据单位表示的固定随机偏移打散重叠的点。见[抖动](#jitter)。 |
| `trendline` | `ScatterTrendline \| ScatterTrendline[]` | — | 按系列拟合的回归线。见[趋势线](#trendlines)。 |
| `axes` | `{ x?: ChartAxisOptions & ChartScaleOptions; y?: ... }` | — | 标题、格式、`scale: 'log'`、`reverse`、`tickCount`。见[数据与坐标轴](../guide/data-and-axes)。 |
| `legend` | `ChartLegendOptions \| boolean` | 2 个及以上系列或有趋势线时显示 | 支持切换和强调的系列图例。 |
| `hover` | `ChartHoverStyle` | `hitRadius: 12` | 散点图始终拾取最近的点。 |
| `showBackdropGrid` | `boolean` | `true` | 水平网格线和基线。 |
| `verticalGrid` | `boolean` | `true` | 在 x 轴刻度处绘制竖直网格线。 |
| `grid` | `ChartGridStyle` | — | 网格样式。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距，单位为 CSS px。 |
| `animation` | `ChartAnimationInput` | SDK 设置 | 进入 / 更新动画。 |
| `width` | `number` | `168` | 绘图区的世界坐标宽度。 |
| `height` | `number` | `94` | 绘图区的世界坐标高度。 |
| `viewMode` | `'2d' \| '3d'` | `'2d'` | 已弃用：仅支持 `'2d'`。 |

## 交互 {#interactions}

- 滚轮同时缩放 x 和 y，拖动平移，双击重置。`zoomChartXY(factor, anchorNdcX?, anchorNdcY?)`、`setXRange`、`setYRange` 和 `resetChartZoom` 可在代码中实现同样的操作。
- 缩放和平移只更新一个变换 uniform；仅当数据或可见系列改变时才会重新上传点。
- 悬停时，引擎用均匀网格哈希查找最近的点：默认在 12 px 以内，或在气泡自身半径以内。提示框显示系列、x 和 y（`ctx.point`）。
- 刷选（`brush: 'xy'`）使用同一个空间哈希选择点；`selection.ids` 保存可见系列中点的 id。

```ts
sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
sdk.on('select', (sel) => console.log(`已选中 ${sel.count} 个点`));
```

见[交互](../guide/interactions)和[提示框与悬停](../guide/tooltips)。

## 对数坐标轴 {#log-axes}

`scale: 'log'` 使用 log10，刻度位于 10 的幂处。对数坐标轴上值 ≤ 0 的点不会被绘制。

## 符号 {#symbols}

```ts
sdk.renderScatterChart(
  { x, y, clusters },
  {
    seriesNames: ['西北', '东北', '西南', '东南'],
    pointRadius: 4,
    seriesSymbols: ['circle', 'square', 'diamond', 'triangle'],
  }
);
```

- `symbol` 设置所有系列的形状；`seriesSymbols` 按系列 id 设置。
- 各形状与折线标记使用相同的有向距离函数进行抗锯齿，视觉分量与圆形大致相同。
- 悬停标记、SVG 导出和图例色块使用相同的形状。三角形色块是 `▲` 字符，因此图片导出中也会保留。
- 命中检测将所有符号视为圆形。

[在线示例](https://jparkk0517.github.io/Charturbo/scatter.html#03-symbols)

## 涟漪效果 {#ripple-effect}

```ts
sdk.renderScatterChart(
  { x, y, clusters, sizes },
  {
    seriesNames: ['读数', '告警'],
    seriesColors: ['#64748b', '#ef4444'],
    ripple: { series: [1], period: 4, scale: 3, count: 3, fill: false },
  }
);
sdk.setEffectTime(1.5); // 固定在周期的第 1.5 秒（截图、导出）
sdk.setEffectTime(null); // 重新播放
```

与 ECharts `effectScatter` 类似，所选系列的每个点后方会出现圆环，从点半径扩大到 `scale` 倍，并在 `period` 秒内淡出。

`ScatterRippleOptions`：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `series` | `number[]` | 所有系列 | 显示涟漪的系列 id。 |
| `period` | `number` | `4` | 每个圆环周期的秒数（至少 0.1）。 |
| `scale` | `number` | `2.5` | 最外圈半径 / 点半径，1–10。 |
| `count` | `number` | `3` | 同时显示的圆环数，1–8，平均分配周期。 |
| `fill` | `boolean` | `false` | 使用半透明填充圆环代替 1.5 px 描边。 |

- 每帧只更新一个时间 uniform。SDK 仅在显示涟漪时运行 `requestAnimationFrame` 循环；图表改变时循环自行停止，隐藏的标签页中由浏览器暂停。
- 设置了 `prefers-reduced-motion: reduce` 时只绘制一帧静止画面。
- `setEffectTime(seconds)` 将圆环固定在周期中的该时刻；`null` 重新播放。
- 涟漪显示期间图表每帧重绘，因此只用于突出少量的点，不要用于整个数据集。SVG 导出不包含圆环。

[在线示例](https://jparkk0517.github.io/Charturbo/scatter.html#04-ripple)

## 抖动 {#jitter}

```ts
sdk.renderScatterChart(
  { x: serviceIndex, y: latencyMs, clusters: serviceIndex },
  { seriesNames: services, opacity: 0.6, jitter: { x: 0.28 } }
);
```

- 与 ggplot2 `geom_jitter` 类似，每个点在 `[-x, x]` 和 `[-y, y]` 数据单位（对数坐标轴上为 10 的幂单位）内移动一个均匀分布的偏移。`x` 和 `y` 默认为 `0`（该轴不偏移）。
- 偏移只取决于点索引和 `seed`（默认 `0`），因此重绘时画面相同。
- 偏移在布局点时加入：坐标轴范围、悬停、刷选和空间哈希都使用抖动后的位置。提示框、数据表和 CSV 显示原始值。
- 这不是 ECharts 那种以像素为单位、避免重叠（beeswarm）的抖动。

[在线示例](https://jparkk0517.github.io/Charturbo/scatter.html#05-jitter)

## 趋势线 {#trendlines}

```ts
const { trendlines } = sdk.renderScatterChart(data, {
  seriesNames: ['产品 A', '产品 B'],
  trendline: { type: 'linear' },                 // 或趋势线数组
});
trendlines[0].expression; // 例如 'y = 1.234x + 5.6'
trendlines[0].r2;
sdk.getScatterTrendlines(); // 当前图表的相同拟合结果；其他图表返回 []
```

与 ECharts ecStat `regression` 类似，每条趋势线用最小二乘法分别拟合所选的每个系列，并绘制在点的下方。

`ScatterTrendline`：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `type` | `'linear' \| 'exponential' \| 'logarithmic' \| 'polynomial'` | — | 回归模型。必填。 |
| `order` | `number` | `2` | 多项式阶数，2–6 的整数（Excel 多项式趋势线同样最高为 6）。 |
| `series` | `number[]` | 所有系列 | 要拟合的系列 id，每个一条线。 |
| `color` | `ColorInput` | 系列颜色 | 线条颜色。 |
| `width` | `number` | `2` | 线宽，单位为 CSS px。 |
| `dash` | `number[]` | 实线 | 虚线模式，单位为 CSS px，`[on, off]` 或 `[on, off, on, off]`。 |

模型：

- `'linear'`：`y = a + bx`，普通最小二乘。
- `'logarithmic'`：`y = a + b·ln(x)`。只拟合 `x > 0` 的点。
- `'exponential'`：`y = a·e^(bx)`，与 ecStat 相同的 y 加权对数最小二乘。只拟合 `y > 0` 的点。
- `'polynomial'`：按 x 升幂排列的系数，在归一化到 [−1, 1] 的 x 上求解。

所有模型的 R² 都基于原始 y 计算 `1 − SS_res / SS_tot`（ecStat 不提供 R²）。超出模型定义域的点不参与拟合，其数量显示在图例、无障碍描述和 `skipped` 中。

- 曲线覆盖可见的 x 范围（包括缩放和对数坐标轴），并按曲率细分。
- 图例以 `y = … (R² = …)` 列出每条线，因此有趋势线时默认显示图例。有多个系列时，系列名称在前。
- 图例和无障碍描述文本跟随图表区域设置。
- `type`、`order`、`series`、`width` 或 `dash` 无效时抛出异常。

`ScatterTrendlineFit`（由 `renderScatterChart` 和 `getScatterTrendlines()` 返回）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `ScatterTrendlineType` | 模型。 |
| `order` | `number` | 多项式阶数（仅多项式拟合）。 |
| `series` | `number` | 拟合的系列 id。 |
| `coefficients` | `number[]` | linear、exponential、logarithmic 为 `[a, b]`；polynomial 为 `[c0, …, ck]`。系列中不同的点太少时为空。 |
| `r2` | `number` | R²（无拟合结果或所有 y 相同时为 `NaN`）。 |
| `points` | `number` | 参与拟合的点数。 |
| `skipped` | `number` | 超出模型定义域、未参与拟合的有限点数。 |
| `expression` | `string` | 方程文本，例如 `y = 1.234x + 5.6`（无拟合结果时为空）。 |
| `color`、`width`、`dash` | `RgbaTuple`、`number`、`number[]` | 解析后的线条样式。 |

[在线示例](https://jparkk0517.github.io/Charturbo/scatter.html#06-trendline)

## 更新数据 {#updating-data}

用新的数组再次调用 `renderScatterChart`。使用 `setSeriesVisible` 可以隐藏某个系列 id 而无需重新上传。

## 注意事项 {#notes}

- 散点图仅限 2D：`z` 和 `viewMode: '3d'` 会被忽略。3D 点请参见 [PointCloud3D · Surface3D](./scientific-3d)。
- 散点图不支持误差棒。

## 另请参阅 {#see-also}

- [折线图](./line)
- [热力图](./heatmap) — 以网格形式展示极其密集的数据
- [交互](../guide/interactions)
