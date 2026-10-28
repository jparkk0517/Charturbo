# 带状图 · 范围图

带状图填充两条边缘之间的区域，不绘制中心线。适用于需要单独展示的预测范围、最小–最大包络和置信区间。如需在折线下方绘制范围带，请改用折线系列的 `band` 选项（见[折线图](./line#range-band)）。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html#06-band)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderBandChart(
  [{
    name: '预测范围',
    x: new Float64Array([0, 1, 2, 3]),
    lower: [8, 12, 20, 11],
    upper: [12, 18, 16, 15], // 允许交叉：通道顺序保持不变
    lowerLineWidth: 1.5,
    upperLineWidth: 1.5,
  }],
  { fillOpacity: 0.3, axes: { x: { title: '时间' } } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBandChart(
  series: BandSeriesDescriptor[],
  options?: BandChartOptions
): { totalPoints: number; seriesCount: number }
```

一对边缘计为一个系列。

## 数据格式 {#data-format}

`BandSeriesDescriptor`：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `name` | `string` | — | 图例和提示框中的名称。 |
| `lower` | `Float32Array \| number[]` | — | 第一条边缘。名称只是约定俗成：与 `upper` 的交叉会被保留。 |
| `upper` | `Float32Array \| number[]` | — | 第二条边缘，与 `lower` 的样本一一对应。 |
| `x` | `Float64Array \| number[] \| Date[]` | — | 每一对的 x。必须有限且非递减。要么为每个系列都提供，要么都不提供。 |
| `color` | `ColorInput` | 主题调色板 | 填充和边缘的颜色。 |
| `yAxis` | `'left' \| 'right'` | `'left'` | 右侧 y 轴。 |
| `curve` | `LineCurve` | `'linear'` | 边缘插值方式，与折线图相同。 |
| `lowerLineWidth` | `number` | 图表的值，否则为 `0` | 下边缘线宽，单位为 CSS px。`0` = 仅填充。 |
| `upperLineWidth` | `number` | 图表的值，否则为 `0` | 上边缘线宽，单位为 CSS px。 |
| `fillOpacity` | `number` | 图表的值，否则为 `0.25` | 系列颜色的 alpha 系数，0..1。 |
| `connectNulls` | `boolean` | 图表的值，否则为 `false` | 跨过缺失的数据对进行连接。 |

- 同一系列中 `lower`、`upper` 和 `x` 的长度必须相同。
- 使用 `axes.x.type: 'time'` 或 `Date[]` 得到时间轴。
- 任一边缘上有无效值的数据对，整对都视为空缺。设置 `connectNulls: true` 时会连接相邻的有效数据对。
- 在两条边缘交叉处，引擎会在真实交点处拆分填充三角形。

## 选项 {#options}

`BandChartOptions` 接受除 `viewMode`、`lineWidth`、`nulls` 和 `animation` 以外的所有[折线图选项](./line#options)，另外还有系列字段的图表级默认值：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `lowerLineWidth` | `number` | `0` | 下边缘线宽的默认值，单位为 CSS px。 |
| `upperLineWidth` | `number` | `0` | 上边缘线宽的默认值，单位为 CSS px。 |
| `fillOpacity` | `number` | `0.25` | 填充 alpha 系数的默认值。 |
| `connectNulls` | `boolean` | `false` | 是否跨过缺失数据对进行连接的默认值。 |

系列的值优先于图表的值。带状图始终为 2D。

## 悬停、提示框与选择 {#hover-tooltips-and-selection}

- 大数据量 LOD 保留两个通道的最小值和最大值以及空缺。
- 悬停和 XY 刷选按真实范围检测，而不是按中点。
- 提示框的 `chartType` 和选区的 `kind` 为 `'band'`。`items[].band` 保存两条原始边缘。`items[].value` 是用于选择的内部中点。
- 支持键盘导航、图例、坐标轴、缩放、平移和 SVG 导出。CSV 导出只写入两条边缘。

见[提示框与悬停](../guide/tooltips)和[交互](../guide/interactions)。

## 更新数据 {#updating-data}

带上两条边缘再次调用 `renderBandChart`。`setSeriesData` 和 `appendSeriesData` 在带状图上会抛出异常，因为它们只会更新一个通道。

## 框架 {#frameworks}

```tsx
<CharturboChart type="band" data={series} options={{ fillOpacity: 0.3 }} />
```

见 [React](../guide/react) 和 [Vue](../guide/vue)。

## 另请参阅 {#see-also}

- [折线图](./line) — 折线下方的 `band` 选项
- [面积图](./area)
- [误差棒 · 脉冲图](./errorbar-impulse)
