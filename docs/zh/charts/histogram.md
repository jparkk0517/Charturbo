# 直方图

直方图对原始值分箱，并为每个箱绘制一根无间隙的柱子。引擎以 O(n) 分箱，因此 1,000,000+ 个值也没有问题。用于展示单个变量的分布。

[在线示例](https://jparkk0517.github.io/Charturbo/bar.html#03-histogram)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const values = new Float32Array(500_000).map(() => Math.random() * 100);
const bins = sdk.renderHistogram(values, { bins: 'auto', title: '响应时间 (ms)' });
console.log(`${bins.binCount} 个箱 (${bins.rule})`);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderHistogram(
  values: Float32Array | number[],
  options?: HistogramChartOptions
): HistogramResult
```

数据点 id 为箱的索引。

## 数据格式 {#data-format}

`values` 是由原始样本组成的扁平 `Float32Array`（推荐）或 `number[]`。非有限值和 `range` 之外的值会被忽略。

该方法返回引擎计算出的分箱结果：

| 字段 | 类型 | 说明 |
|---|---|---|
| `binCount` | `number` | 箱的数量。 |
| `edges` | `Float64Array` | `binCount + 1` 个升序排列的箱边界。 |
| `counts` | `Float64Array` | 每个箱中的样本数。 |
| `heights` | `Float64Array` | 柱子高度：计数，或在 `density: true` 时为密度。 |
| `total` | `number` | 范围内的有限值数量。 |
| `rule` | `'freedman-diaconis' \| 'sturges' \| 'fixed'` | 实际使用的分箱规则。 |

## 选项 {#options}

`HistogramChartOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `bins` | `'auto' \| number` | `'auto'` | `'auto'`：Freedman–Diaconis，IQR 为 0 时使用 Sturges（最多 1000 个箱）。数字表示等宽箱的数量（最多 10000）。 |
| `range` | `[number, number]` | 有限数据的范围 | 分箱范围。超出范围的值会被忽略。 |
| `density` | `boolean` | `false` | 柱子高度为密度，总面积为 1。 |
| `color` | `ColorInput` | 主题 palette[0] | 柱子颜色。 |
| `barGap` | `number` | `1` | 柱子之间的间距，单位为 CSS px。 |
| `cornerRadius` | `number` | `0` | 柱顶圆角，单位为 CSS px。 |
| `title` | `string` | — | 图表标题。 |
| `description` | `string` | — | canvas 的无障碍名称。 |
| `locale` | `string` | SDK 区域设置 | 默认标签的区域设置。 |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | x 轴刻度落在箱边界上，并取边界值。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距，单位为 CSS px。 |
| `hover` | `ChartHoverStyle` | — | 悬停样式。 |
| `grid` | `ChartGridStyle` | — | 网格样式。 |
| `width` | `number` | `164` | 绘图区的世界坐标宽度。 |
| `maxBarHeight` | `number` | `78` | 最高柱子的世界坐标高度。 |

## 悬停 {#hover}

提示框标签为箱的范围 `a – b`，并附带计数（`density: true` 时为密度和计数）。

## 更新数据 {#updating-data}

用新的值再次调用 `renderHistogram`。分箱是 O(n)，因此对大数组重新分箱的开销很低。

## 注意事项 {#notes}

- 直方图始终为竖直方向和 2D。不支持缩放或平移，也没有 `animation` 选项。
- 如需带四分位数的分组分布，请使用[箱线图 · 小提琴图](./box-violin)。

## 框架 {#frameworks}

```tsx
<CharturboChart type="histogram" data={values} options={{ bins: 40 }} />
```

## 另请参阅 {#see-also}

- [柱状图](./bar)
- [箱线图 · 小提琴图](./box-violin)
