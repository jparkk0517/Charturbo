# 面积图

面积图将每个系列填充到基线。支持三种模式：重叠面积、堆叠面积和 100% 堆叠面积。它与折线图共用引擎，因此降采样、坐标轴、缩放和时间轴的行为都相同。适合展示随时间变化的量或总量的构成。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html#02-area-stacked)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const day = 86_400_000;
const x = Array.from({ length: 180 }, (_, i) => Date.UTC(2026, 0, 1) + i * day);
sdk.renderAreaChart(
  [
    { name: '搜索', values: search, x },
    { name: '社交', values: social, x },
  ],
  { mode: 'stacked', title: '各渠道会话数', axes: { x: { type: 'time' } } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderAreaChart(
  seriesList: LineSeriesDescriptor[],
  options?: AreaChartOptions
): { totalPoints: number; seriesCount: number }
```

## 数据格式 {#data-format}

系列与[折线图](./line#data-format)中的 `LineSeriesDescriptor` 对象相同：`name`、`values`、可选的 `x`、`color`、`lineWidth`、`marker`、`dash`、`curve`、`nulls`。

- 堆叠模式（`'stacked'`、`'percent'`）要求各系列长度相同。提供 `x` 时，每个系列都需要相同的 `x`。否则调用会抛出异常。
- `NaN` 会在其所在系列的线条和面积中留下空缺，并对其上方的系列按 0 计算。
- 面积图会忽略 `band` 和 `yAxis`（没有右侧坐标轴）。

## 选项 {#options}

`AreaChartOptions` 接受除 `viewMode` 以外的所有[折线图选项](./line#options)（面积图仅限 2D），另外还有：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mode` | `'overlap' \| 'stacked' \| 'percent'` | `'overlap'` | `'overlap'` 将每个系列填充到 0。`'stacked'` 堆叠各系列。`'percent'` 堆叠并将每个 x 归一化为 100%。 |
| `fillOpacity` | `number` | overlap 为 `0.2`，stacked / percent 为 `0.8` | 系列颜色的填充 alpha 系数。 |

## 模式 {#modes}

- `overlap`：每个系列都填充到 0。
- `stacked`：每个系列叠放在其下方的系列之上。顶部边缘绘制一条线。
- `percent`：在每个 x 处，可见系列之和为 100%。负值按 0 计算。y 轴标签显示 `%`。

数值轴始终包含 0。曲线（`curve`）同样作用于填充；堆叠面积的下边缘沿着下方系列的曲线，既无空隙也不重叠。

设置 `nulls: 'connect'` 时，堆叠面积会沿 x 对缺失值插值以支撑其上方的系列，并跳过自身的标记。

## 图例与提示框 {#legend-and-tooltips}

- 点击图例项会隐藏该系列，引擎随即重新堆叠其余系列。悬停在图例项上会淡化其他填充和线条。
- 提示框显示系列的原始值，而不是堆叠后的值。`'stacked'` 会增加总计（`ctx.total`）；`'percent'` 会增加各自的占比（`item.percent`）。`ctx.areaMode` 保存当前模式。
- 悬停标记位于堆叠后的顶部边缘上。

见[提示框与悬停](../guide/tooltips)。

## 更新数据 {#updating-data}

```ts
// 每个系列一个数据块，按渲染顺序排列
const lengths = sdk.appendAreaData(
  [
    { values: nextSearch, x: nextDays },
    { values: nextSocial, x: nextDays },
  ],
  { maxPoints: 4_000 }
);
sdk.render();
```

| 方法 | 说明 |
|---|---|
| `appendAreaData(chunks, options?)` | 以原子方式为每个系列追加一个数据块。返回每个系列保留的长度。 |
| `setSeriesData(seriesIndex, values, x?)` | 替换一个系列。在堆叠模式下，新数据必须与其他系列保持相同的长度和 `x`。 |
| `appendSeriesData(seriesIndex, values, x?, options?)` | 仅限 `'overlap'`。堆叠模式下会抛出异常；请使用 `appendAreaData`。 |

`appendAreaData` 规则：

- 一批数据必须包含所有系列，包括隐藏的系列。在堆叠模式下，所有数据块需要相同的长度和 `x`。
- 没有 `x` 的图表只接收值。有 `x` 的图表需要每个值对应一个 x（数字或 `Date`）。
- 先校验整批数据。无效的一批数据不会造成任何改动。
- `maxPoints` 是 0..4294967295 范围内的整数；0 或省略表示不限制。裁剪后会重新计算 id。样式、图例可见性和缩放保持不变。
- 堆叠和百分比模式在每次更新时都会对所有保留的样本重新计算累计值（O(保留样本数)）。对于大规模数据流，请调整批量大小和 `maxPoints`。

见[实时数据流](../guide/streaming)。

## 交互 {#interactions}

面积图支持与 2D 折线图相同的交互：滚轮缩放、拖动平移、触摸手势、刷选（选区 `kind` 为 `'line'`）、标注和导航条：

```ts
sdk.renderAreaChart(series, { mode: 'stacked', navigator: true });
```

见[交互](../guide/interactions)。

## 另请参阅 {#see-also}

- [折线图](./line)
- [带状图 · 范围图](./band)
- [组合图](./combo)
- [实时数据流](../guide/streaming)
