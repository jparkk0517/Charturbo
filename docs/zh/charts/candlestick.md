# K 线图 · OHLC

展示开盘 / 最高 / 最低 / 收盘价格的金融图表。`renderCandlestickChart` 绘制 K 线：实体从开盘价到收盘价，影线从最低价到最高价。`renderOhlcChart` 绘制 OHLC 柱：一根最高–最低的竖线，左侧为开盘刻度，右侧为收盘刻度。两者共用时间轴、成交量面板、聚合和导航功能。

[在线示例](https://jparkk0517.github.io/Charturbo/candlestick.html)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });

sdk.renderCandlestickChart(
  { t, open, high, low, close, volume }, // t: Date[] 或毫秒时间戳
  { title: 'ACME', hollowUp: true, yFit: 'visible', axes: { y: { format: '$,.2f' } } }
);
sdk.setXRange(t[t.length - 120], t[t.length - 1]); // 初始显示最后 120 根 K 线
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderCandlestickChart(data: CandlestickChartData, options?: CandlestickChartOptions): { candleCount: number }
renderOhlcChart(data: OhlcChartData, options?: OhlcChartOptions): { barCount: number }
```

数据点 id = K 线的索引。

## 数据格式 {#data-format}

`CandlestickChartData`（`OhlcChartData` 是同一类型）的每个数组中，每根 K 线对应一项：

| 字段 | 类型 | 说明 |
|---|---|---|
| `t` | `Float64Array \| number[] \| Date[]` | 可选，每根 K 线的 x：用于时间轴的毫秒时间戳或 `Date`，或配合 `axes.x.type: 'numeric'` 使用的普通数字。必须有限且升序。省略时按索引放置 K 线。 |
| `open` | `Float32Array \| number[]` | 开盘价。 |
| `high` | `Float32Array \| number[]` | 最高价。 |
| `low` | `Float32Array \| number[]` | 最低价。 |
| `close` | `Float32Array \| number[]` | 收盘价。 |
| `volume` | `Float32Array \| number[]` | 可选，成交量，以柱子形式绘制在底部面板中，拥有独立的刻度。 |

开盘价、最高价、最低价或收盘价不是有限值的 K 线视为空缺。

## 选项 {#options}

`CandlestickChartOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | `string` | — | 图表标题。 |
| `description` | `string` | — | canvas 的无障碍名称。 |
| `upColor` | `ColorInput` | 主题 palette[0]（蓝色） | 上涨 K 线的颜色（收盘价 ≥ 开盘价）。 |
| `downColor` | `ColorInput` | 主题 palette[1]（橙色） | 下跌 K 线的颜色。 |
| `hollowUp` | `boolean` | `true` | 上涨 K 线只绘制轮廓，作为颜色之外的形状提示。较窄的 K 线会被填充。 |
| `wickWidth` | `number` | `1` | 影线 / 轮廓的宽度，单位为 CSS px。 |
| `bodyWidth` | `number` | `0.7` | 实体宽度占 K 线间距的比例。 |
| `cornerRadius` | `number` | `0` | 实体圆角，单位为 CSS px，0..1。 |
| `showVolume` | `boolean` | `true` | 提供 `volume` 时显示成交量面板。 |
| `volumeOpacity` | `number` | `0.45` | 成交量柱的不透明度。 |
| `volumeHeight` | `number` | `0.2` | 成交量面板高度占绘图区的比例。 |
| `yFit` | `'visible' \| 'all'` | `'visible'` | `'visible'`：缩放 / 平移时价格轴适配可见的 K 线。`'all'`：适配所有 K 线。 |
| `axes` | `{ x?: LineXAxisOptions; y?: ChartAxisOptions }` | — | 提供 `t` 时 `x.type` 默认为 `'time'`。见[数据与坐标轴](../guide/data-and-axes)。 |
| `locale` | `string` | SDK 区域设置 | 默认标签和提示框数值的区域设置。 |
| `timeZone` | `CharturboTimeZone` | SDK 时区 | 时间轴及其标签的时区。 |
| `hover` | `ChartHoverStyle` | — | 十字准线样式（竖线位于 K 线处，横线位于指针处）。 |
| `showBackdropGrid` | `boolean` | `true` | 水平网格线和基线。 |
| `grid` | `ChartGridStyle` | — | 网格样式。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距，单位为 CSS px。 |
| `animation` | `ChartAnimationInput` | SDK 设置 | 进入 / 更新动画。 |
| `width` | `number` | `168` | 绘图区的世界坐标宽度。 |
| `height` | `number` | `86` | 绘图区的世界坐标高度。 |

`OhlcChartOptions` 接受除 `hollowUp`、`wickWidth`、`bodyWidth` 和 `cornerRadius` 以外的相同选项，另外增加：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `lineWidth` | `number` | `1` | 竖线和刻度的描边宽度，单位为 CSS px（0.25–8）。 |
| `tickWidth` | `number` | `0.7` | 左右刻度合计跨度占柱间距的比例（0.05–1）。 |

```ts
const { barCount } = sdk.renderOhlcChart({ t, open, high, low, close, volume }, {
  lineWidth: 1.5,
  tickWidth: 0.8,
  showVolume: true,
  yFit: 'visible',
  timeZone: 'UTC',
  axes: { y: { format: '$,.2f' } },
});
```

## 颜色 {#colors}

默认颜色为上涨蓝色、下跌橙色，而不是单纯的红色和绿色，因此在色觉障碍下也能区分。上涨 K 线默认为空心，作为第二种提示。主题切换时默认颜色会随之改变。

## 聚合 {#aggregation}

当 K 线窄于 2 CSS px 时，引擎会将其聚合到 3 px 的桶中：open = 第一个，high = 最大值，low = 最小值，close = 最后一个，volume = 总和。极值得以保留，1,000,000+ 根 K 线依然可以流畅交互。此时提示框显示桶的值和 `count`。

## 交互 {#interactions}

- 滚轮、拖动和双指捏合可缩放和平移 x 轴；双击重置。`setXRange(Date, Date)` 可在代码中缩放。
- 十字准线的竖线位于 K 线处，横线位于指针处。
- 提示框：`ctx.chartType` 为 `'candlestick'` 或 `'ohlc'`；`ctx.ohlc = { open, high, low, close, volume, x, xEnd, count }`。提示框字段标签（Open、High、Low、Close、Volume）跟随图表的区域设置；见[国际化](../guide/i18n)。
- 刷选的 `kind` 为 `'candlestick'` 或 `'ohlc'`；`ids` 为 K 线索引。
- 标注使用 x = `t`，y = 价格。见[标注](../guide/annotations)。
- 支持键盘导航、数据表、CSV 和矢量 SVG 导出。

见[交互](../guide/interactions)和[提示框与悬停](../guide/tooltips)。

## 更新数据 {#updating-data}

用新的数组再次调用 `renderCandlestickChart` 或 `renderOhlcChart`。主题切换时 OHLC 模式保持不变。

## 框架 {#frameworks}

```tsx
<CharturboChart type="candlestick" data={{ t, open, high, low, close }} />
<CharturboChart type="ohlc" data={{ t, open, high, low, close, volume }} options={{ tickWidth: 0.8 }} />
```

## 另请参阅 {#see-also}

- [折线图](./line)
- [数字与日期格式](../guide/number-format)
- [国际化](../guide/i18n)
