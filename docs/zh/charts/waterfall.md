# 瀑布图

`renderWaterfallChart` 用悬浮柱表示累计合计：每个变化柱从上一个合计结束处开始，小计 / 合计柱从零开始。适合说明起始值如何变为结束值，例如现金流或利润桥。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderWaterfallChart(
  {
    labels: ['一季度期初', '销售', '服务', '退款', '上半年', '成本', '税费'],
    values: [400, 180, 90, -60, null, -220, -45], // null = 计算得到的小计
    totals: [4],                                  // "上半年" 小计的索引
  },
  { title: '现金流', total: '期末', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderWaterfallChart(data: WaterfallChartData, options?: WaterfallChartOptions): { itemCount: number }
```

`itemCount` 包含由 `options.total` 追加的柱。

## 数据格式

```ts
interface WaterfallChartData {
  labels: string[];                         // 每个值一个类别
  values: (number | null)[] | Float64Array; // 变化量（有限）；合计项可为 null
  totals?: number[] | boolean[];            // 小计 / 合计项：索引，或每个值一个标志
}
```

- `labels` 与 `values` 长度必须相同，否则抛出 `RangeError`。
- 变化项必须有限（否则抛出异常）。正值为增加，负值为减少。
- 合计项（列在 `totals` 中）是从零到累计合计的柱。其值会被忽略，通常传 `null`。它不改变累计合计。
- `options.total` 在末尾追加一个合计柱。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `total` | `boolean \| string` | | 追加最终合计柱：`true`（名称为 `'合计'`，随语言区域）或其名称。 |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | `'horizontal'` 时类别沿左侧坐标轴排列。 |
| `connectors` | `boolean` | `true` | 从每根柱末端高度连到下一根柱的虚线。 |
| `colors` | `{ increase?, decrease?, total?, connector? }` | 见下文 | 各类型的 `ColorInput`。默认：调色板第一、第二个颜色，合计和连接线使用主题中性基线颜色。 |
| `names` | `{ increase?, decrease?, total? }` | `增加` / `减少` / `合计`（随语言区域） | 图例和提示框中各类型的名称。 |
| `labels` | `boolean \| 'auto' \| Omit<BarLabelOptions, 'format'>` | `'auto'` | 数值标签。`'auto'` 隐藏相互冲突的标签。变化量带符号（`+1,200`、`−300`），合计显示累计合计。 |
| `cornerRadius` | `number` | `0` | 数据端圆角半径（CSS px）。 |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | | 与柱状图相同的坐标轴选项。见[数据与坐标轴](../guide/data-and-axes)。 |
| `showBackdropGrid` | `boolean` | `true` | 数值网格线和基线。 |
| `grid` | `ChartGridStyle` | 主题 | 网格线样式。见[样式与主题](../guide/styling)。 |
| `hover` | `ChartHoverStyle` | 主题 | 悬停柱的高亮。 |
| `format` | `ChartValueFormat` | 本地化数字 | 标签、提示框和无障碍文本的数值格式（格式字符串、`Intl` 选项或函数）。未设置坐标轴格式时，数值轴也使用它。见[数字与日期格式](../guide/number-format)。 |
| `valueLabel` | `string` | `'变化'`（随语言区域） | 提示框和数据表中变化量的名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `legend` | `ChartLegendOptions \| boolean` | 类型 ≥ 2 时显示 | 列出出现的类型。静态图例，不支持切换或突出显示。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

去掉 `format` 的 `BarLabelOptions` 包含 `show`、`position` 和 `color`，见[柱状图](./bar)。

## 颜色

增加、减少和合计使用调色板颜色和中性色，从不只依赖红 / 绿区分。标签和提示框始终带符号（`+180`、`−60`），合计只显示数值。

```ts
sdk.renderWaterfallChart(data, {
  colors: { increase: '#3987e5', decrease: '#d95926', total: '#a3a29c' },
  names: { increase: '收益', decrease: '损失', total: '余额' },
});
```

## 交互

调用 `enableNodeInteractions(canvas)` 开启。悬停、横向布局、坐标轴、网格线和标签冲突处理与柱状图相同。不支持刷选、缩放和平移；在光标联动中，瀑布图与柱状图一样参与 x 光标联动。数据点 id 为项目索引。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'waterfall'
// ctx.index = 柱索引
// ctx.waterfall = { kind: 'increase' | 'decrease' | 'total', change, start, end }
// change：变化量（合计项为累计合计）
```

## 说明

- 累计合计在引擎（Rust）中计算，并以 2D 柱状图的悬浮柱绘制；连接线也由引擎绘制。
- 无障碍：摘要（最终合计、最大增加 / 减少）、数据表（项目、Change、Running total），左右方向键在柱之间移动。见[无障碍](../guide/accessibility)。

## 另请参阅

- [柱状图](./bar)
- [漏斗图](./funnel)
- [仪表盘联动](../guide/dashboard-sync)
- [数字与日期格式](../guide/number-format)
