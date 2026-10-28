# 饼图 · 环形图

`renderPieChart` 绘制饼图；设置 `donut` 后绘制环形图。适合展示一个整体被少数几个类别划分的占比；类别较多或需要跨组比较时，柱状图更易读。

[在线示例](https://jparkk0517.github.io/Charturbo/pie.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPieChart(
  { labels: ['搜索', '直接访问', '社交', '邮件', '广告'], values: [420, 260, 180, 90, 40] },
  { title: '流量来源', sort: 'desc', donut: 0.6, centerLabel: '访问量' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true }); // 悬停、提示框、图例
sdk.render();
```

签名：

```ts
renderPieChart(data: PieChartData, options?: PieChartOptions): { sliceCount: number }
```

`sliceCount` 是实际显示的扇区数，包含折叠后的 "Other" 扇区。

## 数据格式

```ts
interface PieChartData {
  labels: string[];                  // 每个值一个名称
  values: Float64Array | number[];   // 有限且 >= 0
}
```

- 所有值必须有限且 `>= 0`，否则抛出异常。
- 百分比以可见扇区的合计为基准计算。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `donut` | `number` | `0` | 内孔半径占外半径的比例。`0` = 饼图，最大 `0.95`。 |
| `sort` | `'none' \| 'desc'` | `'none'` | `'desc'` 时最大的扇区排在最前。"Other" 始终在最后。 |
| `maxSlices` | `number \| false` | `8` | 显示的扇区数（含 "Other"），更小的扇区折叠进 "Other"。`0` / `false` 关闭折叠。 |
| `startAngle` | `number` | `0` | 第一个扇区的起始角度（从 12 点方向顺时针，单位为度）。 |
| `direction` | `'clockwise' \| 'counterclockwise'` | `'clockwise'` | 扇区方向。 |
| `colors` | `(ColorInput \| null \| undefined)[]` | 主题调色板 | 每个输入值的颜色。缺省项按显示顺序使用主题调色板。 |
| `otherColor` | `ColorInput` | 主题中性色 | "Other" 扇区的颜色。 |
| `otherLabel` | `string` | `'其他'`（随语言区域） | 折叠扇区的名称。 |
| `labels` | `'outside' \| 'percent' \| 'none'` | `'outside'` | `'outside'`：名称 + 百分比，带引导线。`'percent'`：百分比显示在扇区内。 |
| `labelMinAngle` | `number` | `6` | 角度小于该值（度）的扇区不显示标签，仅出现在图例和提示框中。 |
| `centerLabel` | `boolean \| string` | 环形图为 `true` | 环形图中心文字：可见合计（悬停时为该扇区）。`true` 时标题为 `Total`，字符串替换标题，`false` 隐藏。 |
| `format` | `(value: number) => string` | 本地化数字 | 标签、提示框和中心文字的数值格式。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 提示框和数据表中数值的名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `legend` | `ChartLegendOptions \| boolean` | 扇区 ≥ 2 时显示 | `{ show, toggle, emphasize }`。点击隐藏扇区，悬停突出显示。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px，`top`、`right`、`bottom`、`left`）。 |
| `animation` | `ChartAnimationInput` | SDK 设置 | 本图表的 enter / update 动画。见[动画](../guide/animation)。 |

::: tip 提示
与雷达图、仪表盘、漏斗图、瀑布图不同，饼图的 `format` 只接受函数。若要使用 `'$,.0f'` 这类格式字符串，请用 `createFormatter` 生成函数，详见[数字与日期格式](../guide/number-format)。

```ts
import { createFormatter } from 'charturbo';
sdk.renderPieChart(data, { format: createFormatter('$,.0f') });
```
:::

## "Other" 折叠

值的个数超过 `maxSlices` 时，最小的若干值合并为一个名为 `otherLabel` 的扇区，放在最后。该扇区的提示框通过 `ctx.slice.members` 列出被折叠的名称。

```ts
sdk.renderPieChart(
  {
    labels: ['搜索', '直接访问', '社交', '邮件', '广告', '推荐', '播客', '活动', '印刷', '广播'],
    values: [420, 260, 180, 90, 40, 32, 18, 12, 6, 4],
  },
  { title: '流量来源', sort: 'desc', maxSlices: 7, otherLabel: '其他' }
);
```

## 交互

调用 `enableNodeInteractions(canvas)` 开启。

- 悬停时指针下的扇区向外移出 6 px 并显示提示框。环形图的中心标签会切换为悬停的扇区。
- 点击图例隐藏扇区，其余扇区重新布局，百分比随可见合计变化。悬停图例突出显示扇区。
- 饼图不支持刷选、缩放和光标联动。
- 数据点 id 为显示扇区的索引。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'pie'
// ctx.index = 显示扇区索引
// ctx.slice = { label, value, percent, members? }  // members：折叠进 "Other" 的名称
```

## 说明

- 校验、折叠、排序、角度、百分比、三角剖分、命中测试和标签布局均在引擎（Rust）中完成，DOM 只负责放置标签文字。
- 扇区之间留有 2 px 间隙，边缘抗锯齿，扇区面积保持精确。
- 无障碍：主要扇区摘要、数据表（扇区、值、百分比），左右方向键在扇区间移动。见[无障碍](../guide/accessibility)。

## 另请参阅

- [漏斗图](./funnel)
- [矩形树图 · 旭日图](./treemap-sunburst)
- [提示框与悬停](../guide/tooltips)
- [样式与主题](../guide/styling)
- [动画](../guide/animation)
