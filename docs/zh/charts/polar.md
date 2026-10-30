# 极坐标

`renderPolarChart` 在极坐标系中绘制系列：角度轴绕圆一周，半径轴从中心向外（ECharts `polar` + `angleAxis` / `radiusAxis`）。两个轴都可以是类目轴或数值轴。系列支持径向柱、环形柱、堆叠柱、折线（开放或闭合、平滑、面积填充）、散点和热力单元格。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html#08-polar-bar)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPolarChart(
  {
    series: [
      { type: 'bar', name: 'Sales', data: [5, 8, 3, 6, 9, 4], roundCap: true },
      { type: 'bar', name: 'Cost', data: [3, 4, 6, 2, 5, 7] },
    ],
  },
  { title: 'Weekly sales', angleAxis: { data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }, innerRadius: 0.15 }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderPolarChart(data: PolarChartData, options?: PolarChartOptions): { seriesCount: number; itemCount: number }
```

## 数据格式

```ts
interface PolarChartData { series: PolarSeriesOptions[] }

interface PolarSeriesOptions {
  type: 'bar' | 'line' | 'scatter' | 'heatmap';
  name?: string;
  data: ArrayLike<number | null> | ReadonlyArray<ReadonlyArray<number | string | null>>;
  stack?: string;
  color?: ColorInput;
  roundCap?: boolean;   // 柱
  smooth?: boolean;     // 折线
  area?: boolean;       // 折线
  closed?: boolean;     // 折线
  symbolSize?: number;  // 折线 / 散点，CSS px
  lineWidth?: number;   // 折线，CSS px
}
```

- 恰好有一个类目轴时，柱和折线系列可以是简单数组：每个类目一个值（`null` = 缺失）。
- 否则与 ECharts 相同，项目是 `[半径, 角度]` 对。热力项目是 `[半径, 角度, 值]` 单元格（`值` 为 `null` 表示空单元格）。类目轴上的坐标是类目名称或索引。
- 柱需要恰好一个类目轴。角度轴为类目轴时柱向外生长（径向柱）；半径轴为类目轴时柱沿圆周延伸（环形柱）。
- 热力图需要角度轴和半径轴都是类目轴。
- `stack` 名称相同的系列会堆叠，正值和负值分别堆叠。
- 上限：64 个系列、200,000 个项目、每个轴 10,000 个类目。
- 输入在替换当前图表之前校验。抛出异常时保留之前的图表。

## 坐标轴

```ts
interface PolarAxisOptions {
  type?: 'category' | 'value'; // 默认：有 data 时为 'category'，否则为 'value'
  data?: string[];             // 类目名称
  min?: number;
  max?: number;
  splitNumber?: number;        // 刻度数量提示，默认 5
  labels?: boolean;            // 默认 true
  splitLine?: boolean;         // 圆（半径）/ 辐射线（角度），默认 true
  name?: string;               // 提示框 / 表格名称
}
```

数值轴按数据生成整齐的刻度。半径轴从 0 开始。角度轴覆盖整圈时，如果最后一个刻度与第一个重合或过近，会被去掉。

```ts
sdk.renderPolarChart(
  {
    series: [
      { type: 'bar', name: 'A', data: [40, 28, 35, 22], stack: 'total' },
      { type: 'bar', name: 'B', data: [25, 30, 18, 26], stack: 'total' },
    ],
  },
  { radiusAxis: { data: ['N', 'S', 'E', 'W'] }, angleAxis: { max: 100 }, startAngle: 90 }
);
```

[在线示例：堆叠环形柱](https://jparkk0517.github.io/Charturbo/business.html#09-polar-stacked)

## 折线与散点

```ts
const curve = Array.from({ length: 36 }, (_, k) => [2 + Math.sin(k / 3), k * 10]);
sdk.renderPolarChart(
  {
    series: [
      { type: 'line', name: 'Curve', data: curve, smooth: true, closed: true, area: true },
      { type: 'scatter', name: 'Points', data: [[1, 30], [3.5, 140], [4, 250]], symbolSize: 8 },
    ],
  },
  { angleAxis: { min: 0, max: 360 }, radiusAxis: { max: 5 } }
);
```

[在线示例](https://jparkk0517.github.io/Charturbo/business.html#10-polar-line)

## 极坐标热力图

```ts
const hours = Array.from({ length: 24 }, (_, h) => `${h}h`);
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
sdk.renderPolarChart(
  { series: [{ type: 'heatmap', name: 'Requests', data: days.flatMap((d) => hours.map((h, i) => [d, h, i % 7])) }] },
  { angleAxis: { data: hours }, radiusAxis: { data: days }, innerRadius: 0.2, colorScale: 'viridis' }
);
```

颜色使用[热力图](./heatmap)的色彩映射（`colorScale`、`color`、`reverse`、`min` / `max` / `center`）和色条。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html#11-polar-heatmap)

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `angleAxis` | `PolarAxisOptions` | 数值轴 | 角度轴。 |
| `radiusAxis` | `PolarAxisOptions` | 数值轴 | 半径轴。 |
| `startAngle` | `number` | `0` | 角度轴起点，从 12 点方向顺时针的度数（与饼图、和弦图相同）。ECharts 从 3 点方向逆时针计算。 |
| `clockwise` | `boolean` | `true` | 角度轴顺时针。 |
| `innerRadius` | `number` | `0` | 中心空洞，占外半径的比例（0 至 0.9）。 |
| `barCategoryGap` | `number` | `0.2` | 类目间隔，占类目宽度的比例（0 至 0.95）。 |
| `barGap` | `number` | `0.3` | 同一类目内柱间隔，占柱宽的比例（-1 至 10）。 |
| `palette` | `ColorInput[]` | 主题调色板 | 系列颜色。 |
| `showGrid` | `boolean` | `true` | 分隔圆和辐射线。 |
| `legend` | `boolean \| ChartLegendOptions` | 2 个以上系列时显示 | 系列图例。悬停强调，点击隐藏。 |
| `colorScale` · `color` · `reverse` | | `'sequential'` | 热力色彩映射，同 `renderHeatmap`。 |
| `min` · `max` · `center` | `number` | 数据范围 | 热力值域。 |
| `emptyColor` | `ColorInput` | 主题网格色 | 无值的热力单元格。 |
| `colorbar` | `boolean \| HeatmapColorbarOptions` | 有热力系列时显示 | 热力色条。 |
| `valueLabel` | `string` | `'数值'`（本地化） | 提示框、表格和色条中热力值的名称。 |
| `format` | `ChartValueFormat` | 本地数字 | 提示框、标签和无障碍的数值文本。见[数字与日期格式](../guide/number-format)。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图边距（CSS px）。 |

无效输入会抛出异常：未知的系列或轴类型、类目轴不是恰好一个的柱系列、没有两个类目轴的热力图、未知类目、非有限值或边界、`min >= max`、超出范围的 `innerRadius` / `barCategoryGap` / `barGap` / `symbolSize` / `lineWidth`，以及过多的系列、项目或类目。

## 交互

调用 `enableNodeInteractions(canvas)` 开启。

- 悬停柱或单元格时描出轮廓，折线和点按距离命中。提示框显示系列、角度和半径坐标以及值。
- 悬停图例强调系列。点击隐藏系列，重新堆叠柱并重新适配数值轴。开启 `animation` 时过渡到新布局。
- 刷选、缩放和平移被禁用。

数据点 id：系列 `s` 的项目 `i` 为 `s` 之前各系列的项目数之和加 `i`。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'polar'
// ctx.polar = { series, seriesName, type, index, angle, radius, value }
// angle / radius：类目名称或格式化后的值；value：热力图为单元格值，否则为数值轴坐标
```

## 说明

- 轴比例、刻度、柱、折线、单元格、网格、命中测试、强调和标签位置均在引擎（Rust）中计算。图形是矢量形状，`exportChartSVG` 会写成 SVG 路径。
- 无障碍：摘要给出系列数和两个轴的范围。数据表和 `exportChartCSV` 列出所有项目（系列、角度、半径，热力图还有值）。按键：左 / 右在系列内移动，上 / 下切换系列，Home / End 跳到第一 / 最后一项，Page Up / Page Down 每次移动 10 项。见[无障碍](../guide/accessibility)。
- 标签宽度为估算值（11 px 文字每字符约 6.8 px）。
- React / Vue：`type="polar"`。

## 另请参阅

- [雷达图](./radar)
- [饼图 · 环形图](./pie)
- [热力图](./heatmap)
