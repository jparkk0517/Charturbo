# 平行坐标

`renderParallelChart` 为每一行绘制一条穿过多根坐标轴的折线（ECharts `parallel`）。坐标轴可以是数值轴、类别轴或时间轴，并排或上下堆叠排列。沿坐标轴拖动即可刷选一个区间，刷选范围外的行会变淡。适合在多个维度上比较大量记录并交互式筛选，例如汽车、商品、实验运行、传感器日志。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html#05-parallel)

## 基本用法

```ts
import { Charturbo, type ParallelChartData } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const data: ParallelChartData = {
  dimensions: ['MPG', 'Horsepower', { name: 'Origin', categories: ['US', 'EU', 'JP'] }, { name: 'Year', type: 'time' }, { name: 'Weight', inverse: true }],
  series: [
    { name: 'Sedan', data: [[31, 88, 'JP', new Date('1978-01-01'), 2200], [24, 110, 'EU', new Date('1974-01-01'), 2700]] },
    { name: 'Truck', data: [[16, 150, 'US', new Date('1972-01-01'), 4100]] },
  ],
};
sdk.renderParallelChart(data, { title: 'Cars' });
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderParallelChart(data: ParallelChartData, options?: ParallelChartOptions): { rowCount: number; dimensionCount: number; seriesCount: number }
setParallelBrush(intervals: ParallelBrushInterval[]): number   // 活动行数
clearParallelBrush(): void
getParallelBrush(): ParallelBrushRange[]
getParallelActiveRows(): number[]
exportParallelCSV(options?: { activeOnly?: boolean }): string
```

## 数据格式

```ts
interface ParallelChartData {
  dimensions: (string | ParallelDimension)[]; // 2 到 64 根轴；字符串表示数值轴
  rows?: ParallelCell[][];                     // 单个系列
  series?: ParallelSeries[];                   // 或按系列分组的行
}

interface ParallelDimension {
  name: string;
  type?: 'value' | 'category' | 'time';        // 默认：由第一个单元格推断
  min?: number | string | Date;                // 默认：数据范围取整
  max?: number | string | Date;
  inverse?: boolean;                           // 较大值靠近轴起点
  categories?: string[];                       // 轴上顺序（默认：首次出现顺序）
  format?: ChartValueFormat;                   // 刻度、提示框和无障碍文本
}

interface ParallelSeries { name?: string; data: ParallelCell[][]; color?: ColorInput }

type ParallelCell = number | string | Date | null | undefined;
```

- 每行在每个维度上有一个单元格。字符串单元格是类别，`Date`（或纪元毫秒、日期字符串）是时间。
- `null` / `undefined` 表示缺失值，折线在该轴处断开。类别单元格也可以是类别索引。
- 最多 1,000,000 行。无效输入（非数值、无效日期、不在给定 `categories` 中的名称、长度不符的行、`min` 不小于 `max`、不存在的 `colorBy`、无效颜色）会在清除当前图表之前抛出错误。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `orient` | `'horizontal' \| 'vertical'` | `'horizontal'` | 水平：坐标轴并排，数值向上。垂直：坐标轴堆叠，数值向右。 |
| `lineWidth` | `number` | `1` | 线宽（CSS px）。 |
| `opacity` | `number` | `0.45` | 线条不透明度，0–1。 |
| `smooth` | `boolean` | `false` | 在坐标轴之间使用平滑曲线。 |
| `colorBy` | `number \| string` | | 按数值或时间维度通过热力图色带为行着色（带色条）。 |
| `colorScale` · `color` · `reverse` | | `'viridis'` | `colorBy` 的色带，与[热力图](./heatmap)相同。 |
| `colorRange` | `[number, number]` | 数据范围 | `colorBy` 的颜色范围。 |
| `colorbar` | `HeatmapColorbarOptions \| boolean` | 显示 | `colorBy` 的色条。 |
| `brush` | `ParallelBrushInterval[]` | | 初始刷选（不触发事件）。 |
| `brushable` | `boolean` | `true` | 指针和键盘刷选。 |
| `inactiveOpacity` | `number` | `0.25` | 刷选范围外的行的不透明度（相对于 `opacity`）。 |
| `inactiveColor` | `ColorInput` | 主题 grid 色 | 刷选范围外的行淡化到的颜色。 |
| `brushColor` | `ColorInput` | 主题 crosshair，25% 透明度 | 刷选带颜色。 |
| `axisColor` | `ColorInput` | 主题 baseline | 坐标轴线颜色。 |
| `legend` | `ChartLegendOptions \| boolean` | 无 `colorBy` 且 2 个以上系列 | 系列图例；点击切换系列。 |
| `format` | `ChartValueFormat` | 区域设置数字 | 未设置自身 `format` 的数值轴的数值文本。 |
| `title` · `description` · `padding` | | | 标题、无障碍名称、绘图区边距。 |

```ts
sdk.renderParallelChart(data, { orient: 'vertical', smooth: true });
sdk.renderParallelChart(data, { colorBy: 'MPG', colorScale: 'magma', opacity: 0.6 });
```

## 刷选

- 沿坐标轴拖动即可在该轴上刷选一个区间。Shift + 拖动在同一根轴上再添加一个区间。不拖动直接单击坐标轴会清除该轴的刷选。
- 同一根轴上的多个区间取并集，多根轴上的刷选取交集。Escape 清除全部刷选。
- 刷选变化时只重写 GPU 上的每行标志；折线几何在每次 `renderParallelChart` 时只上传一次。
- `setParallelBrush` 接受以轴取值表示的区间（类别名称、日期、数字，顺序任意，每根轴最多 16 个）。`[]` 表示清除。

```ts
sdk.setParallelBrush([
  { dimension: 'Origin', range: ['EU', 'JP'] },
  { dimension: 'Weight', range: [1800, 2600] },
  { dimension: 'Weight', range: [3200, 3600] },
]);
sdk.on('parallelBrush', (e) => console.log(e.activeCount, e.total, e.intervals, e.source));
// e.source: 'pointer' | 'keyboard' | 'api'
const rows = sdk.getParallelActiveRows();          // 刷选范围内的行索引
const csv = sdk.exportParallelCSV({ activeOnly: true });
```

React 和 Vue：`<CharturboChart type="parallel" data={...} options={...} onParallelBrush={...} />`（Vue：`@parallel-brush`）。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html#06-parallel-brush)

## 性能

100,000 行 × 8 维（700,000 条线段）依然可以流畅交互：CPU 上构建图表约 11 ms，刷选变化约 1 ms（上传 400 KB 标志），悬停命中测试不到 1 ms（release 构建，桌面端）。大数据示例会实时显示构建、刷选和帧时间。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html#07-parallel-large)

## 交互

调用 `enableNodeInteractions(canvas)` 开启交互。悬停会高亮最近的折线并显示该行的所有维度。缩放、平移和光标同步处于关闭状态。

提示框上下文（参见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'parallel'
// ctx.xLabel = 'Sedan · Row 12'
// ctx.parallel = { row, series, seriesName, values: [{ dimension, value, text }, ...] }
```

## 说明

- 无障碍：摘要（行数、维度数、系列数、刷选范围内的行数），每个维度一句话（范围或类别），每根已刷选的轴一句话，以及数据表。键盘：Up / Down（垂直：Left / Right）按当前轴上的数值顺序在行之间移动，Left / Right（垂直：Up / Down）切换坐标轴，支持 Home / End、Page Up / Down；按住 Shift 移动会从起点开始刷选范围，Delete 清除当前轴，Escape 清除全部。参见[无障碍](../guide/accessibility)。
- CSV 导出包含所有行（系列，然后每个维度一列）；SVG 导出以矢量绘制折线、坐标轴和刷选带。
- 标签：水平布局时刻度位于每根轴左侧，名称位于绘图区上方；垂直布局时刻度位于每根轴下方，名称位于左侧。

## 另请参阅

- [热力图](./heatmap)（色带与色条）
- [雷达图](./radar)
- [提示框与悬停](../guide/tooltips)
