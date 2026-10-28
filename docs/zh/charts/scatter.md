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
renderScatterChart(data: ScatterChartData, options?: ScatterChartOptions): { pointCount: number }
```

数据点 id = 点的索引。

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
| `axes` | `{ x?: ChartAxisOptions & ChartScaleOptions; y?: ... }` | — | 标题、格式、`scale: 'log'`、`reverse`、`tickCount`。见[数据与坐标轴](../guide/data-and-axes)。 |
| `legend` | `ChartLegendOptions \| boolean` | 2 个及以上系列时显示 | 支持切换和强调的系列图例。 |
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

## 更新数据 {#updating-data}

用新的数组再次调用 `renderScatterChart`。使用 `setSeriesVisible` 可以隐藏某个系列 id 而无需重新上传。

## 注意事项 {#notes}

- 散点图仅限 2D：`z` 和 `viewMode: '3d'` 会被忽略。3D 点请参见 [PointCloud3D · Surface3D](./scientific-3d)。
- 散点图不支持误差棒。

## 另请参阅 {#see-also}

- [折线图](./line)
- [热力图](./heatmap) — 以网格形式展示极其密集的数据
- [交互](../guide/interactions)
