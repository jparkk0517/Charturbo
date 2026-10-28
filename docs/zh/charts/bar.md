# 柱状图

柱状图用于比较各类别之间的数值。`renderBarChart` 绘制单个系列；`renderGroupedBarChart` 以分组、堆叠或 100% 堆叠的方式绘制多个系列。柱子可以是竖直或水平方向，可以带有数据标签和误差棒，也可以切换为带光照的 3D 矩阵视图。

[在线示例](https://jparkk0517.github.io/Charturbo/bar.html)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGroupedBarChart(
  {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '北区', values: [10, 20, 30, 40] },
      { name: '南区', values: [5, -5, 15, NaN] }, // NaN = 无值
    ],
  },
  { mode: 'stacked', title: '营收' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBarChart(
  items: BarChartItemDescriptor[],
  options?: BarChartOptions
): { barCount: number }

renderGroupedBarChart(
  data: GroupedBarChartData,
  options?: GroupedBarChartOptions
): { barCount: number; seriesCount: number; categoryCount: number }
```

## 数据格式 {#data-format}

### 单系列

`renderBarChart` 每根柱子接收一个项：

```ts
sdk.renderBarChart(
  [
    { label: '周一', value: 42, error: 4 },
    { label: '周二', value: 37 },
  ],
  { labels: true, legend: true, seriesName: '访问量' }
);
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `label` | `string` | 类别标签。 |
| `value` | `number` | 柱子的值。负值悬挂在零基线下方。 |
| `error` | `number \| [number, number] \| null` | 误差棒：以数值单位表示的 `±e` 或 `[minus, plus]`（2D）。 |
| `category` | `string` | 可选的分组键。未设置 `color` 选项时，同一类别的项共用一种调色板颜色，单系列图例会列出这些类别。 |
| `color` | `ColorInput` | 柱子颜色。优先于类别颜色和 `color` 选项。 |
| `attributes` | `Record<string, string \| number \| boolean>` | 合并到柱子详情中的额外键 / 值（`getNodeDetails`、点击回调）。 |

数据点 id 为柱子的索引。

### 多系列

`renderGroupedBarChart` 接收 `{ categories, series }`。每个系列每个类别一个值；`NaN` 表示无值。

| 字段 | 类型 | 说明 |
|---|---|---|
| `categories` | `string[]` | 类别标签。 |
| `series[].name` | `string` | 系列名称。 |
| `series[].values` | `Float32Array \| number[]` | 每个类别一个值。 |
| `series[].error` | `(number \| [number, number] \| null)[]` | 每个类别的误差棒（`null` = 无）。 |
| `series[].color` | `ColorInput` | 默认：按系列顺序使用主题调色板。 |

数据点 id = `seriesIndex * categories.length + categoryIndex`。

## 选项 {#options}

`BarChartOptions`（两个方法通用）：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | `string` | — | 图表标题。 |
| `description` | `string` | — | canvas 的无障碍名称。 |
| `viewMode` | `'2d' \| '3d'` | `'2d'` | 平面柱子或带光照的 3D 矩阵。多系列 3D 只显示第一个系列。 |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | 水平柱子（仅限 2D）。 |
| `labels` | `boolean \| 'auto' \| BarLabelOptions` | 关闭 | 数据标签（2D）。见[数据标签](#data-labels)。 |
| `errorBars` | `BarErrorBarStyle` | — | 误差棒外观。见[误差棒](#error-bars)。 |
| `background` | `boolean \| BarBackgroundOptions` | 关闭 | 每根柱子后方贯穿整个数值轴的背景轨道（2D）。见[背景轨道](#background-tracks)。 |
| `legend` | `ChartLegendOptions \| boolean` | 多系列：2 个及以上系列时显示；单系列：隐藏 | 单系列：显示由各项 `category` 值组成的静态图例，或一个名为 `seriesName` 的图例项。 |
| `seriesName` | `string` | `'数值'`（随语言区域） | 单系列图表的图例项名称。 |
| `color` | `ColorInput` | 调色板第一种颜色 | 未设置 `color` 的项的默认柱子颜色。 |
| `cornerRadius` | `number` | `4` | 数据端圆角，单位为 CSS px（2D）。 |
| `barThickness` | `number` | 槽位的 72% | 柱子宽度，使用世界坐标单位。 |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | 坐标轴标题和格式。使用 `'horizontal'` 时，`x` 为数值轴，`y` 为类别轴。`axes.x.labelRotate` 旋转 x 轴刻度标签，见[标签旋转](#label-rotation)。 |
| `hover` | `ChartHoverStyle` | — | 悬停样式，例如 `barHighlightColor`。 |
| `grid` | `ChartGridStyle` | — | 网格行数、颜色、线宽。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距，单位为 CSS px。 |
| `animation` | `ChartAnimationInput` | SDK 设置 | 进入 / 更新动画。 |
| `width` | `number` | `164` | 绘图区的世界坐标宽度。 |
| `maxBarHeight` | `number` | `78` | 最高柱子的世界坐标高度。 |

`GroupedBarChartOptions` 另外增加：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mode` | `'grouped' \| 'stacked' \| 'percent'` | `'grouped'` | 系列并排、堆叠或堆叠到 100%。 |
| `groupGap` | `number` | `0.28` | 每个类别槽位中组与组之间空白所占的比例。设置 `barThickness` 时忽略。 |
| `barGap` | `number` | `2` | 同组柱子之间或堆叠段之间的间距，单位为 CSS px。 |

## 模式 {#modes}

- `grouped`：各系列在每个类别槽位内并排排列。
- `stacked`：正值向上堆叠，负值向下堆叠，两者分开计算。数值轴使用堆叠后的总和。只有最外侧的段端是圆角。
- `percent`：每个类别的绝对值之和归一化为 100%。y 轴标签显示 `%`。

## 水平柱状图 {#horizontal-bars}

```ts
sdk.renderGroupedBarChart(data, { orientation: 'horizontal' });
```

- 类别沿左侧坐标轴向下排列，第一个类别位于顶部。标签会被抽稀，大约每 18 px 一个。
- 数值沿 x 轴排列，使用整齐刻度和竖直网格线。圆角端朝右（负值朝左）。
- 适用于单系列、分组、堆叠和百分比柱子。左边距会适配类别标签的长度。
- 水平柱子关闭刷选。标注使用 x = 值，y = 类别索引。
- 3D 柱子和直方图始终为竖直方向。

## 数据标签 {#data-labels}

```ts
sdk.renderGroupedBarChart(data, {
  labels: { show: 'auto', position: 'inside', format: { maximumFractionDigits: 1 } },
});
```

`labels` 接受 `true`、`'auto'` 或 `BarLabelOptions`：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `show` | `boolean \| 'auto'` | `true` | `'auto'` 会把放不下的内部标签移到外部，并隐藏超出 canvas、与其他标签重叠或遮住其他柱子的标签。 |
| `position` | `'outside' \| 'inside' \| 'insideBase' \| 'center'` | `'outside'` | `'outside'` 位于数据端及其误差棒之外。 |
| `format` | 函数、格式说明字符串或 `Intl.NumberFormatOptions` | 数值轴格式 | `(value, ctx) => string`、`'.1f'` 或 `'$,.0f'` 这样的格式说明，或 `Intl` 选项。百分比柱子格式化的是占比。 |
| `color` | `ColorInput` | 自动 | 外部：主题文字颜色。内部：根据柱子亮度选用浅色或深色。 |
| `rotate` | `number` | `0` | 文字旋转角度（度），正值为逆时针，-90..90。见[标签旋转](#label-rotation)。 |

- 引擎以 CSS px 计算标签锚点、适配和碰撞检测；DOM 只负责放置文字。PNG 导出包含标签。
- 堆叠段的标签始终位于内部（居中），且仅在文字放得下时显示。
- 格式说明见[数字与日期格式](../guide/number-format)。

## 误差棒 {#error-bars}

在项上设置 `error`，或在系列上设置 `error[]`：以数值单位表示的 `±e` 或 `[minus, plus]`。

| `errorBars` 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `color` | `ColorInput` | 主题次要文字颜色 | 描边颜色。 |
| `width` | `number` | `1.25` | 描边宽度，单位为 CSS px。 |
| `cap` | `number` | `0.4` | 端帽长度占柱子宽度的比例。`0` = 无端帽。 |

引擎绘制带端帽的线段，并将其计入数值值域（堆叠柱子：位于该段堆叠后的末端；百分比模式忽略误差）。提示框显示 `±e` 或 `+p / −m`（`ChartTooltipItem.error`）。

## 背景轨道 {#background-tracks}

```ts
sdk.renderBarChart(items, { background: true });
sdk.renderGroupedBarChart(data, { mode: 'stacked', background: { color: '#94a3b8', opacity: 0.18 } });
```

与 ECharts `showBackground` 类似，`background` 在每根柱子后方绘制一条贯穿整个数值轴的轨道，宽度和圆角与柱子相同。

| `background` 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `color` | `ColorInput` | 主题 `baseline`，alpha × 0.2 | 轨道颜色（ECharts 默认轨道为 `rgba(180,180,180,0.2)`）。 |
| `opacity` | `number` | `1` | 颜色 alpha 的系数，0–1。 |

- 分组柱状图每个柱位一条轨道，包括缺失值的柱位（与 ECharts 相同）。堆叠和百分比柱状图每个类别一条轨道。
- 隐藏系列时其轨道也随之移除。进入动画期间轨道保持完整长度。
- 轨道不是悬停目标。
- 仅限 2D 柱状图：3D 视图、直方图、瀑布图和组合图不支持。

[在线示例](https://jparkk0517.github.io/Charturbo/bar.html#04-background)

## 标签旋转 {#label-rotation}

```ts
sdk.renderGroupedBarChart(data, {
  labels: { rotate: 90, position: 'insideBase' },
  axes: { x: { labelRotate: 30, format: (i) => categories[i] ?? '' } },
});
```

两个选项都以度为单位，正值为逆时针，范围 -90..90（超出范围的值会被截断），与 ECharts `label.rotate` 和 `axisLabel.rotate` 相同。

- `labels.rotate` 旋转柱子的数值标签。位置、内部适配判断和 `'auto'` 碰撞隐藏都使用旋转后文字的包围盒，适用于所有 `position`，也适用于水平柱状图。
- `axes.x.labelRotate` 旋转 x 轴刻度标签（仅限 x 轴）。与 ECharts 相同，正角度时文字末端对齐刻度，负角度时文字开头对齐刻度。标签按旋转后的占位进行抽稀，自动计算的底部内边距按旋转后的高度增加（显式指定的 `padding.bottom` 保持不变）。
- 旋转后的类别标签显示完整名称；未旋转时超过 12 个字符的类别名称会被截短。
- 非类别轴的 x 轴在首次布局后底部内边距可能再增加一次。
- 不支持：y 轴标签旋转、瀑布图数值标签旋转，以及两端标签左右溢出时的额外内边距。

[在线示例](https://jparkk0517.github.io/Charturbo/bar.html#05-label-rotation)

## 图例、悬停与选择 {#legend-hover-and-selection}

- 多系列图例：点击会隐藏一个系列，引擎随即重新布局或重新堆叠（数值轴保持不变）；悬停会淡化其他系列。`setSeriesVisible(i, false)` 和 `emphasizeSeries(i)` 效果相同。
- 悬停：分组柱子报告指针下方的柱子。堆叠 / 百分比柱子报告该类别的所有系列（提示框 `ctx.total`、`item.percent`），并以指针下方的段为主项。
- 刷选始终选择一个 x 方向的类别范围。

见[提示框与悬停](../guide/tooltips)和[交互](../guide/interactions)。

## 更新数据 {#updating-data}

柱状图没有局部更新方法。请用新数据再次调用 `renderBarChart` 或 `renderGroupedBarChart`。仅修改样式时：`setChartHoverStyle`、`setChartGrid`。

## 框架 {#frameworks}

`type="bar"` 接受项数组（单系列）或 `{ categories, series }`：

```tsx
<CharturboChart type="bar" data={{ categories, series }} options={{ mode: 'stacked' }} />
```

## 另请参阅 {#see-also}

- [直方图](./histogram)
- [组合图](./combo) — 柱子与折线组合
- [数字与日期格式](../guide/number-format)
