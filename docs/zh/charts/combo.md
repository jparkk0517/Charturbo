# 组合图

组合图在同一个绘图区中绘制柱状、折线和面积系列。这些系列共用类别轴或 x 轴，可选的右侧 y 轴可以承载第二种单位。适用于相互关联的度量，例如营收柱子加一条目标线。

[在线示例](https://jparkk0517.github.io/Charturbo/combo.html)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderComboChart(
  {
    categories: ['1月', '2月', '3月', '4月'],
    series: [
      { name: '线上', type: 'bar', values: [12, 18, 22, 19] },
      { name: '零售', type: 'bar', values: [8, 9, 7, 11] },
      { name: '目标', type: 'area', values: [18, 22, 26, 28] },
      { name: '利润率 %', type: 'line', yAxis: 'right', values: [21, 24, 23, 27],
        marker: true, dash: [5, 3], curve: 'monotone' },
    ],
  },
  {
    barMode: 'stacked',
    title: '营收与利润率',
    axes: { x: { title: '月份' }, y: { title: '营收', min: 0 }, y2: { title: '%', format: (v) => `${v}%` } },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderComboChart(
  data: ComboChartData,
  options?: ComboChartOptions
): { seriesCount: number; categoryCount: number; pointCount: number }
```

数据点 id = `series * categories + category`。

## 数据格式 {#data-format}

`ComboChartData`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `categories` | `string[]` | 类别 x 轴的类别标签。 |
| `x` | `Float64Array \| number[] \| Date[]` | 或者，每个类别的数值 / 时间 x：必须严格递增；时间使用毫秒时间戳或 `Date[]`。 |
| `series` | `ComboSeriesDescriptor[]` | 每个系列中每个类别一个值。 |

`ComboSeriesDescriptor`：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `name` | `string` | — | 图例和提示框中的名称。 |
| `type` | `'bar' \| 'line' \| 'area'` | — | `'area'` 是向下填充到零的半透明折线。 |
| `values` | `Float32Array \| number[]` | — | 每个类别一个值。`NaN` / `null` = 缺失。 |
| `yAxis` | `'left' \| 'right'` | `'left'` | 只要有一个 `'right'` 系列，就会增加右侧 y 轴（`axes.y2`）。所有柱状系列共用第一个柱状系列的坐标轴。 |
| `color` | `ColorInput` | 主题调色板 | 系列颜色。 |
| `lineWidth` | `number` | 图表的 `lineWidth` | 折线 / 面积系列的线宽，单位为 CSS px。 |
| `marker`, `dash`, `curve`, `nulls` | 线条样式 | — | 折线 / 面积系列接受[线条样式](./line#line-styles)。 |

使用数值或时间 `x` 时，柱子槽位宽度为最小的 x 间距（柱子永不重叠；柱宽为槽位的 72%），x 轴刻度与折线图相同，为数值 / 日历刻度。

## 选项 {#options}

`ComboChartOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `barMode` | `'grouped' \| 'stacked' \| 'percent'` | `'grouped'` | 柱状系列的布局。 |
| `axes` | `{ x?: ComboXAxisOptions; y?: ComboYAxisOptions; y2?: ComboYAxisOptions }` | — | 见下文。 |
| `title` | `string` | — | 图表标题。 |
| `description` | `string` | — | canvas 的无障碍名称。 |
| `legend` | `ChartLegendOptions \| boolean` | 2 个及以上系列时显示 | 点击切换显示（柱子重新堆叠），悬停时强调。 |
| `groupGap` | `number` | `0.28` | 每个类别槽位中柱子组之间空白所占的比例。 |
| `barGap` | `number` | `2` | 分组柱子之间或堆叠段之间的间距，单位为 CSS px。 |
| `cornerRadius` | `number` | `4` | 柱子端部圆角，单位为 CSS px。 |
| `fillOpacity` | `number` | `0.2` | 面积系列的填充 alpha 系数。 |
| `lineWidth` | `number` | `2` | 折线 / 面积系列的线宽，单位为 CSS px。 |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | `'gap'` | 折线 / 面积系列的缺失样本处理。系列的 `nulls` 优先。 |
| `hover` | `ChartHoverStyle` | — | 悬停样式。 |
| `showBackdropGrid` | `boolean` | `true` | 水平网格线和基线。 |
| `grid` | `ChartGridStyle` | — | 网格样式。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距，单位为 CSS px。 |
| `locale` | `string` | SDK 区域设置 | 默认数字 / 时间标签的区域设置。 |
| `timeZone` | `CharturboTimeZone` | SDK 时区 | 时间 x 轴的时区。 |
| `width` | `number` | `168` | 绘图区的世界坐标宽度。 |
| `height` | `number` | `86` | 绘图区的世界坐标高度。 |

坐标轴选项：

| 坐标轴 | 字段 | 说明 |
|---|---|---|
| `x` | `ChartAxisOptions` + `type?: 'numeric' \| 'time'` | `type` 作用于显式提供的 `x`：`'numeric'`（默认）或 `'time'`（`Date[]` 时的默认值）。 |
| `y`, `y2` | `ChartAxisOptions` + `min?`, `max?`, `nice?` | 固定值域端点。`nice`（默认 `true`）将由数据得出的端点扩展到完整的刻度步长。 |

## 布局 {#layout}

- 类别 `i` 位于数据 x `i`（或 `x[i]`）处。x 值域两侧各加宽半个槽位，因此折线上的点正好落在柱子槽位的中心。
- 柱状系列使用柱状图引擎（分组 / 堆叠 / 百分比，切换图例时重新堆叠）。折线和面积系列使用折线图引擎（M4 降采样、标记、虚线、曲线、缺失值策略）。
- 绘制顺序：先柱子，再面积填充（半透明，填充到 0），然后是折线，最后是标记。
- 面积不堆叠：每个面积都填充到 0。

## Y 值域 {#y-domains}

- 值域是固定的（无自动缩放）。每个坐标轴覆盖其所有系列，包括隐藏的系列（堆叠柱子：取总和），并扩展到整齐的刻度。
- 柱状轴和面积系列始终包含 0。由 `nulls: 'zero'` 填充的零值计入值域。
- 用 `axes.y` / `axes.y2` 的 `min`、`max`、`nice` 固定端点。用 `getYDomain()` 和 `getY2Domain()` 读取。
- 如果所有系列最终都在右侧坐标轴上，它们会被移到左侧坐标轴。
- 不支持对数刻度和反向刻度。

::: warning 注意
双 y 轴会诱使读者比较互不相关的刻度：仅凭两个范围的选取，就能让一条折线看起来与柱子“交叉”。只在单位不同时才使用右侧坐标轴，并为两个坐标轴都清晰地加上标签。请优先考虑共用同一 x 轴的两个图表，或单一的指数化坐标轴。
:::

## 悬停与图例 {#hover-and-legend}

- 悬停使用索引模式：一个提示框（`chartType: 'combo'`）列出悬停类别处的所有可见系列。柱子会着色高亮，折线和面积上的点会显示标记，有折线系列时还会绘制十字准线。
- 主项是离指针最近的柱子段或折线点（位于柱子内的折线点优先）。`hover: { mode: 'nearest' }` 或 `tooltip: { shared: false }` 只显示该项。
- `hoverAtX`（光标联动）会吸附到最近的类别。
- 图例符号：柱状 = 方块，折线 = 线段，面积 = 带顶线的浅色块。切换显示会重新堆叠或重新分组柱子（值域保持固定）。强调会淡化所有其他系列，无论其类型。

见[提示框与悬停](../guide/tooltips)和[仪表盘联动](../guide/dashboard-sync)。

## 缩放与平移 {#zoom-and-pan}

x 方向的缩放和平移可以通过滚轮、拖动、触摸和 `setXRange` 实现。柱子随缩放窗口变宽，并被裁剪在绘图区内。

组合图不支持：刷选、导航条、柱子数据标签、柱子误差棒和折线范围带。

## 无障碍 {#accessibility}

摘要（按类型列出的系列、双坐标轴、范围）、描述（坐标轴标题；每个系列的类型、坐标轴、最大值、最小值和均值）、数据表和 CSV（行 = 类别，列 = 所有系列），以及键盘导航（左 / 右 = 类别，上 / 下 = 系列）。见[无障碍](../guide/accessibility)。

## 更新数据 {#updating-data}

用新的数据再次调用 `renderComboChart`。

## 框架 {#frameworks}

```tsx
<CharturboChart type="combo" data={{ categories, series }} options={{ barMode: 'grouped' }} />
```

## 另请参阅 {#see-also}

- [柱状图](./bar)
- [折线图](./line)
- [面积图](./area)
- [数据与坐标轴](../guide/data-and-axes)
