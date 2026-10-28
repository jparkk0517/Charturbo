# 误差棒 · 脉冲图

两种用于独立样本的独立图表。误差棒图在每个中心值周围绘制从下界到上界的须线。脉冲图（茎图）从基线向每个样本绘制一根茎。两种图表都不会像折线那样连接相邻样本，也不会对其降采样。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html#08-error-bars)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderErrorBarChart([
  { name: '测量值', x: [1, 2, 3], values: [10, 15, 12], errorLow: 2, errorHigh: [3, 5, 4],
    capWidth: 12, showCenter: true },
]);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

// 脉冲图
sdk.renderImpulseChart([
  { name: '事件', x: [0, 1, 2, 3], values: [0, 5, -3, 0], baseline: 0, showMarker: true },
]);
sdk.render();
```

```ts
renderErrorBarChart(
  series: ErrorBarSeriesDescriptor[],
  options?: ErrorBarChartOptions
): { totalPoints: number; seriesCount: number }

renderImpulseChart(
  series: ImpulseSeriesDescriptor[],
  options?: ImpulseChartOptions
): { totalPoints: number; seriesCount: number }
```

## 数据格式 {#data-format}

两种图表共用以下系列字段：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `name` | `string` | — | 图例和提示框中的名称。 |
| `values` | `Float32Array \| number[]` | — | 中心值（误差棒）或样本值（脉冲图）。 |
| `x` | `Float64Array \| number[] \| Date[]` | 索引 | 有限且非递减。要么为每个系列都提供，要么都不提供。 |
| `color` | `ColorInput` | 主题调色板 | 系列颜色。 |
| `lineWidth` | `number` | 图表的值，否则为 `1.5` | 线宽，单位为 CSS px。 |
| `yAxis` | `'left' \| 'right'` | `'left'` | 右侧 y 轴。 |

### 误差棒边界

每个误差棒系列必须且只能使用以下三种表示方式之一：

| 字段 | 含义 |
|---|---|
| `low`, `high` | 绝对边界，每个值一个。上下颠倒的边界会被交换。 |
| `error` | 对称相对误差：数字或数组。 |
| `errorLow`, `errorHigh` | 非对称相对误差：数字或数组。 |

相对误差取其绝对值，并以 `values` 为中心应用。混用多种表示方式会抛出异常。

### 误差棒样式

这些字段可以按系列设置，也可以在选项中设为图表级默认值。系列的值优先。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `errorMode` | `'both' \| 'high' \| 'low'` | `'both'` | `'both'` 绘制 low ↔ high。`'high'` / `'low'` 绘制中心 ↔ 对应边界。 |
| `direction` | `'vertical' \| 'horizontal'` | `'vertical'` | `'horizontal'`：`low` / `high` 为 x 坐标，`values` 为 y 坐标。 |
| `capWidth` | `number \| string` | `'40%'` | 端帽的完整长度：以 CSS px 为单位的数字，或相对于平均类别间距的百分比字符串（`'55%'`）。 |
| `drawWhiskers` | `boolean` | `true` | 绘制端帽。 |
| `drawConnector` | `boolean` | `true` | 绘制两个边界之间的茎线。 |
| `showCenter` | `boolean` | `false` | 在中心值处显示标记。 |
| `symbolSize` | `number` | `6` | 中心标记的大小。 |

- 所用边界或中心值不是有限值的样本视为空缺。
- 设置 `direction: 'horizontal'` 时，中心标记位于 `(x, values)`。相对误差和单侧茎线仍以 `values` 为基准，与 ChartGPU v0.4.0 相同。如需常规的水平置信区间，请使用绝对的 `low` / `high` 和 `errorMode: 'both'`。

### 脉冲图样式

可按系列设置，也可设为图表级默认值：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `baseline` | `number` | `0` | 茎的底部，使用数据单位。 |
| `showMarker` | `boolean` | `true` | 顶端的圆形标记。当值等于基线时，不绘制茎，只保留标记。 |
| `symbolSize` | `number` | `6` | 顶端标记的大小。 |

## 选项 {#options}

`ErrorBarChartOptions` 和 `ImpulseChartOptions` 接受除 `viewMode`、`nulls` 和 `animation` 以外的所有[折线图选项](./line#options)，并以上述样式字段作为默认值。默认 `lineWidth` 为 `1.5`。两种图表都仅限 2D，且没有采样选项。

```ts
sdk.renderErrorBarChart(
  [{ name: '估计值', x: [12, 20, 28], values: [1, 2, 3],
     low: [5, 8, 20], high: [22, 35, 39], direction: 'horizontal', showCenter: true }],
  { title: '置信区间', capWidth: 16, axes: { x: { title: '效应' } } }
);
```

## 悬停、提示框与选择 {#hover-tooltips-and-selection}

- 指针按真实的茎线、端帽和标记进行命中检测。
- XY 刷选会选中在数据单位下穿过选框的茎线 / 边界。以 CSS px 为单位的端帽宽度不计入刷选范围。
- 提示框的 `chartType` 和选区的 `kind` 为 `'errorBar'` 或 `'impulse'`。误差棒的项带有 `errorBar: { low, high, direction }`；脉冲图的项带有 `baseline`。
- 键盘提示框和 CSV 给出中心值、low 和 high（误差棒），或值和基线（脉冲图）。SVG 导出写入矢量路径。
- 支持颜色、右侧 y 轴、图例、缩放和平移。

见[提示框与悬停](../guide/tooltips)和[交互](../guide/interactions)。

## 更新数据 {#updating-data}

带上所有通道再次调用 `renderErrorBarChart` 或 `renderImpulseChart`。`setSeriesData` 和 `appendSeriesData` 在这两种图表上都会抛出异常。

## 框架 {#frameworks}

```tsx
<CharturboChart type="errorBar" data={series} options={{ capWidth: 12 }} />
<CharturboChart type="impulse" data={series} />
```

见 [React](../guide/react) 和 [Vue](../guide/vue)。

更多示例：[水平误差棒](https://jparkk0517.github.io/Charturbo/line.html#09-error-horizontal)、[脉冲图](https://jparkk0517.github.io/Charturbo/line.html#10-impulse)。

## 另请参阅 {#see-also}

- [折线图](./line)
- [带状图 · 范围图](./band)
- [柱状图](./bar) — 柱子上的误差棒
