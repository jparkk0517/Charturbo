# 雷达图

`renderRadarChart` 绘制雷达图（蜘蛛图）：在 3 条及以上的坐标轴上，为每个系列绘制一个闭合多边形。适合在同一组属性上比较少数几个对象。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderRadarChart(
  {
    axes: ['速度', '续航', '成本', '舒适', '安全'],
    series: [
      { name: '车型 A', values: [82, 64, null, 71, 90] }, // null = 缺失
      { name: '车型 B', values: [55, 88, 70, 62, 74], color: '#d95926' },
    ],
  },
  { title: '车型对比', max: 100, rings: 4, format: '.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderRadarChart(data: RadarChartData, options?: RadarChartOptions): { axisCount: number; seriesCount: number }
```

## 数据格式

```ts
interface RadarChartData {
  axes: string[];          // 轴名称，从 startAngle 起顺时针；至少 3 个
  series: RadarSeries[];   // 1 到 8 个系列
}

interface RadarSeries {
  name: string;
  values: ArrayLike<number | null>;  // 每个轴一个值；有限且 >= 0，null / NaN = 缺失
  color?: ColorInput;                // 默认：该系列的主题调色板颜色
}
```

- 每个系列必须为每个轴提供且仅提供一个值，系列数必须为 1 到 8，否则抛出 `RangeError`。
- 负值或无穷值会抛出异常。缺失值（`null` / `NaN`）所在的轴上，多边形经过中心且不绘制标记。
- 系列颜色按固定顺序取自主题调色板（不循环）。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `max` | `number \| (number \| null \| undefined)[]` | 数据的 nice 最大值 | 所有轴共享的径向最大值，或每轴一个（`null` = 共享最大值）。仅在共享刻度时显示环标签。 |
| `rings` | `number` | `4` | 目标环数（nice 步长）。 |
| `fillOpacity` | `number` | `0.2` | 多边形填充不透明度。`0` = 仅描边。 |
| `strokeWidth` | `number` | `2` | 多边形描边宽度（CSS px）。 |
| `markers` | `boolean \| number` | `true`（半径 3.5 px） | 顶点标记：`true`、`false` 或半径（CSS px）。 |
| `startAngle` | `number` | `0` | 第一个轴的角度（从 12 点方向顺时针，单位为度）。 |
| `grid` | `'polygon' \| 'circle'` | `'polygon'` | 同心网格形状。 |
| `showGrid` | `boolean` | `true` | 显示环和辐条。 |
| `format` | `ChartValueFormat` | 本地化数字 | 环、提示框和无障碍文本的数值格式（格式字符串、`Intl` 选项或函数）。见[数字与日期格式](../guide/number-format)。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 提示框和数据表中数值的名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `legend` | `ChartLegendOptions \| boolean` | 系列 ≥ 2 时显示 | `{ show, toggle, emphasize }`。点击切换系列，悬停突出显示。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

## 交互

调用 `enableNodeInteractions(canvas)` 开启。

- 悬停时选取与指针角度最近的轴，返回该轴上所有可见系列；最近的顶点为 primary 项。对应辐条高亮，标记放大。
- 点击图例隐藏系列；悬停图例时其他系列变淡，突出的系列绘制在最上层。
- 不支持刷选、缩放和平移。
- 数据点 id 为 `series * axes + axis`。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'radar'
// ctx.index = 轴索引
// ctx.items = 该轴上所有可见系列
// ctx.radar = { axis, max }
```

## 说明

- nice 径向刻度、每轴最大值、多边形 / 网格 / 标记几何、命中测试和标签锚点均在引擎（Rust）中计算。线和标记在 GPU 上以 CSS px 尺寸绘制。
- 使用每轴最大值时省略环数值标签。
- 无障碍：摘要（每个系列的最高轴）、数据表（轴 × 系列），左右方向键切换轴，上下方向键切换系列。见[无障碍](../guide/accessibility)。

## 另请参阅

- [仪表盘](./gauge)
- [饼图 · 环形图](./pie)
- [提示框与悬停](../guide/tooltips)
- [数字与日期格式](../guide/number-format)
