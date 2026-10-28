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
renderPieChart(data: PieChartData | PieRingsData, options?: PieChartOptions): { sliceCount: number }
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
- 如需多个同心圆环，请改为传入 `{ rings }`，见[多层圆环](#nested-rings)。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `donut` | `number` | `0` | 内孔半径占外半径的比例。`0` = 饼图，最大 `0.95`。 |
| `sort` | `'none' \| 'desc'` | `'none'` | `'desc'` 时最大的扇区排在最前。"Other" 始终在最后。 |
| `maxSlices` | `number \| false` | `8` | 显示的扇区数（含 "Other"），更小的扇区折叠进 "Other"。`0` / `false` 关闭折叠。 |
| `startAngle` | `number` | `0` | 第一个扇区的起始角度（从 12 点方向顺时针，单位为度）。 |
| `endAngle` | `number` | 整圈 | 最后一个扇区的结束角度（从 12 点方向顺时针，单位为度）。见[圆角、间隙与部分圆](#corners-gaps-and-partial-circles)。 |
| `direction` | `'clockwise' \| 'counterclockwise'` | `'clockwise'` | 扇区方向。 |
| `padAngle` | `number` | `0` | 扇区之间的角度间隙（度，最大 45），叠加在 2 px 间隙之上。 |
| `cornerRadius` | `number` | `0` | 将每个扇区的角按该值（CSS px）倒圆。 |
| `rose` | `'radius' \| 'area'` | 关闭 | 南丁格尔玫瑰图：扇区半径表示数值。见[南丁格尔玫瑰图](#nightingale-rose)。 |
| `colors` | `(ColorInput \| null \| undefined)[]` | 主题调色板 | 每个输入值的颜色。缺省项按显示顺序使用主题调色板。使用 `rings` 时按各圆环数值依次拼接的顺序。 |
| `otherColor` | `ColorInput` | 主题中性色 | "Other" 扇区的颜色。 |
| `otherLabel` | `string` | `'其他'`（随语言区域） | 折叠扇区的名称。 |
| `labels` | `'outside' \| 'percent' \| 'none'` | `'outside'` | `'outside'`：名称 + 百分比，带引导线。`'percent'`：百分比显示在扇区内。 |
| `labelMinAngle` | `number` | `6` | 角度小于该值（度）的扇区不显示标签，仅出现在图例和提示框中。 |
| `centerLabel` | `boolean \| string` | 环形图为 `true`（玫瑰图和多层圆环饼图关闭） | 环形图中心文字：可见合计（悬停时为该扇区）。`true` 时标题为 `Total`，字符串替换标题，`false` 隐藏。 |
| `format` | `(value: number) => string` | 本地化数字 | 标签、提示框和中心文字的数值格式。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 提示框和数据表中数值的名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `legend` | `ChartLegendOptions \| boolean` | 扇区 ≥ 2 时显示 | `{ show, toggle, emphasize, position, overflow }`。点击隐藏扇区，悬停突出显示。 |
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

## 多层圆环 {#nested-rings}

```ts
sdk.renderPieChart(
  {
    rings: [
      { name: '渠道', labels: ['Direct', 'Marketing', 'Search engine'], values: [1548, 775, 679], radius: [0, 0.42] },
      {
        name: '来源',
        labels: ['Baidu', 'Direct', 'Email', 'Google', 'Union ads', 'Bing', 'Video ads', 'Others'],
        values: [1048, 335, 310, 251, 234, 147, 135, 102],
        radius: [0.56, 0.86],
        maxSlices: false,
      },
    ],
  },
  { title: '访问来源' }
);
```

与 ECharts 嵌套饼图类似，`{ rings: PieRingData[] }` 按给定顺序从内到外绘制多个圆环。

`PieRingData`：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | `环 1`、`环 2`……（随语言区域） | 在提示框、数据表和键盘播报中使用的圆环名称。 |
| `labels` | `string[]` | — | 每个值一个名称。 |
| `values` | `Float64Array \| number[]` | — | 有限且 `>= 0` 的值。 |
| `radius` | `[number, number]` | 均分 | `[inner, outer]`，为占完整半径的比例，`0 <= inner < outer <= 1`。 |
| `label` | `'outside' \| 'percent' \| 'none'` | 内层圆环为 `'percent'`，最外层为图表的 `labels` | 圆环的标签模式。 |
| `maxSlices` | `number \| false` | 图表的 `maxSlices` | 圆环的 "Other" 折叠。 |
| `sort` | `'none' \| 'desc'` | 图表的 `sort` | 圆环的扇区顺序。 |

- 百分比（相对圆环合计）、角度、"Other" 折叠和标签均按圆环分别计算。
- 未设置 `radius` 时，`n` 个圆环中的第 `k` 个占据从 `donut` 到外缘区间均分后的第 `k` 份，相邻圆环之间留有小间隙。
- 名称相同的扇区跨圆环共用颜色、图例项和图例突出显示。点击图例会在所有圆环中隐藏该名称。
- 命中测试先按半径确定圆环，再在该圆环内按角度查找扇区。
- 提示框、数据表和键盘播报以 `圆环 · 扇区` 的形式命名扇区。未设置 `centerLabel` 时不显示环形图中心标签。
- `colors` 按各圆环数值依次拼接后的索引取色。

[在线示例](https://jparkk0517.github.io/Charturbo/pie.html#06-nested)

## 圆角、间隙与部分圆 {#corners-gaps-and-partial-circles}

```ts
sdk.renderPieChart(data, { donut: 0.55, padAngle: 5, cornerRadius: 10 });       // 圆角、间隙
sdk.renderPieChart(data, { donut: 0.55, startAngle: -90, endAngle: 90 });        // 上半环形图
```

- `cornerRadius`（CSS px）：每个角的圆同时与内缩后的边和圆弧相切，与 d3-shape `cornerRadius` 的作图方式相同。细扇区和细圆环会缩小半径，避免角相互交叉。无内孔的饼图中心保持尖角。命中测试使用倒圆前的形状。
- `padAngle`（度，最大 45）：在 2 px 间隙之上再增加角度间隙。角度、百分比和命中测试使用无间隙的布局。比间隙还窄的扇区不绘制，但仍保留在图例、提示框和数据表中。只有一个可见扇区时绘制无间隙的整圆。
- `endAngle` 与 `startAngle` 使用相同的方位角：`startAngle: -90, endAngle: 90` 为上半环形图。各扇区沿 `direction` 方向分配该范围。结束角等于或早于起始角时为整圈；超过一整圈时截为一圈（与仪表盘规则相同）。视图按该范围的包围盒取景，因此半环形图会填满卡片。

在线示例：[半环形图](https://jparkk0517.github.io/Charturbo/pie.html#04-half-donut)、[圆角](https://jparkk0517.github.io/Charturbo/pie.html#05-rounded)。

## 南丁格尔玫瑰图 {#nightingale-rose}

```ts
sdk.renderPieChart(
  { labels: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], values: [40, 38, 32, 30, 28, 26, 22, 18] },
  { rose: 'area', donut: 0.2, maxSlices: false }
);
```

设置 `rose` 后，扇区半径表示数值，使每个扇区的面积（环形图为环面积）与数值成正比，即南丁格尔的极区图：`r² = r_in² + v / max · (R² − r_in²)`。

- `'radius'`：角度仍按占比分配。`'area'`：可见扇区平分角度。
- 百分比、提示框和数据表仍显示占合计的比例。
- 通过图例隐藏扇区时，按剩余的最大值重新计算半径。
- 悬停、键盘焦点和外部引导线跟随各扇区的半径。只有设置了 `centerLabel` 时才显示环形图中心标签。
- ECharts 将最小值 → 内半径、最大值 → 外半径线性映射；Charturbo 不这样做，因为这会让最小的扇区消失，并夸大面积。

[在线示例](https://jparkk0517.github.io/Charturbo/pie.html#03-rose)

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
