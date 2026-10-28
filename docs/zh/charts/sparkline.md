# 迷你图

`renderSparkline` 绘制文字大小的折线、面积、柱形或胜负（win / loss）图，不带坐标轴、网格、图例、标题和覆盖层 DOM。适合放在表格或 KPI 行中；页面上数量较多时，请配合共享 GPU 设备使用。

[在线示例](https://jparkk0517.github.io/Charturbo/sparklines.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!; // 例如 120 × 30 CSS px
const sdk = await Charturbo.create(canvas);

sdk.renderSparkline([100, 104, 98, 107, 112, 109, 115], {
  type: 'line',
  showLast: true,
  showMinMax: true,
  label: '收入',
});
sdk.render();
```

签名：

```ts
renderSparkline(data: SparklineData | Float32Array | number[], options?: SparklineOptions): SparklineResult
```

## 数据格式

可以直接传入数值，也可以传入带 `x` 的对象：

```ts
interface SparklineData {
  values: Float32Array | number[]; // NaN = 断点；胜负图：每个值的符号
  x?: Float64Array | number[] | Date[]; // 仅折线 / 面积；规则与折线系列的 `x` 相同
}
```

- `'winloss'` 读取每个值的符号：`> 0` 胜，`< 0` 负，`0` 平（空位）。
- `'bar'` 和 `'winloss'` 忽略 `x`。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | `'line' \| 'area' \| 'bar' \| 'winloss'` | `'line'` | `'winloss'` 按符号绘制等高的向上 / 向下柱。 |
| `color` | `ColorInput` | 调色板第一个颜色 | 系列、柱或胜柱的颜色。 |
| `negativeColor` | `ColorInput` | 调色板第二个颜色 | `'winloss'` 的负柱颜色。 |
| `lineWidth` | `number` | `1.5` | 线宽（CSS px）。 |
| `showLast` | `boolean` | `false` | 在最后一个样本上绘制系列颜色的标记。`'winloss'` 忽略。 |
| `showMinMax` | `boolean` | `false` | 最小值和最大值标记。`'winloss'` 忽略。 |
| `markerRadius` | `number` | `2.5` | 标记半径（CSS px）。 |
| `lastColor` | `ColorInput` | 系列颜色 | 最后一个样本标记的颜色。 |
| `minMaxColor` | `ColorInput` | 主题次要文本颜色 | 最小 / 最大值标记颜色。 |
| `band` | `[number, number]` | | 以数据单位表示的参考带 `[lo, hi]`（例如目标范围），绘制在系列下方。 |
| `bandColor` | `ColorInput` | 主题弱化文本颜色，15% 透明度 | 参考带颜色，其 alpha 原样使用。 |
| `fillOpacity` | `number` | `0.2` | 面积填充 alpha 系数。 |
| `width` | `number` | 画布 CSS 尺寸减去内边距 | 以世界单位表示的绘图宽度；只有宽高比有意义。 |
| `height` | `number` | 画布 CSS 尺寸减去内边距 | 以世界单位表示的绘图高度。 |
| `padding` | `number` | `2`（有标记时为标记半径 + 1） | 绘图区四周的 CSS px。 |
| `tooltip` | `boolean` | `false` | 内置悬停提示框。为 `false` 时不创建提示框 DOM 和指针监听。 |
| `label` | `string` | `'迷你图'`（随语言区域） | 用于 aria-label 和提示框的名称，例如 `'Revenue'`。 |
| `description` | `string` | 自动生成的趋势摘要 | 画布的无障碍名称，替换自动生成的摘要。 |
| `formatValue` | `(v: number) => string` | 本地化，最多 2 位小数 | aria-label 和提示框中数值的格式。 |

`width` 和 `height` 都未设置时，绘图区跟随画布 CSS 尺寸，缩放导致宽高比变化时会重新适配。y 轴范围紧贴数据（不做 nice 取整）。

## 返回值

```ts
interface SparklineResult {
  pointCount: number;
  summary: SparklineSummary | null; // 引擎计算的数据趋势
  label: string;                    // 赋给画布的 aria-label
}

interface SparklineSummary {
  count: number;
  first: number; last: number; min: number; max: number;
  firstIndex: number; lastIndex: number; minIndex: number; maxIndex: number;
  changePct: number; // first → last，占 |first| 的百分比（first 为 0 时为 NaN）
}
```

## 无障碍

画布只添加 `role="img"` 和 `aria-label`，不创建描述 DOM、实时区域或 `tabindex`。`getChartSummary()` 返回相同的句子。

- 折线 / 面积 / 柱形：`"Revenue: trend up 12% from 100 to 112, min 95, max 120"`
- 胜负图：`"Results: 7 wins, 3 losses, last: win"`

以上示例为英文区域设置下的文本；实际文本跟随图表的区域设置。见[国际化](../guide/i18n)。

## 更新数据

`'line'` 和 `'area'` 迷你图可以用 `setSeriesData` 替换数据而无需重新渲染图表。引擎会重新计算最后 / 最小 / 最大值标记和趋势摘要。

```ts
sdk.setSeriesData(0, nextValues);
sdk.render();
```

`setSeriesData` 只适用于折线图，因此 `'bar'` 和 `'winloss'` 需要用新数据再次调用 `renderSparkline`。

## 同一页面上的大量迷你图

`Charturbo.create(canvas)` 会为每个画布请求 GPU 设备并编译全部管线，而浏览器把 WebGL 上下文限制在约 16 个。对于包含几十上百个迷你图的表格，请创建一个 `CharturboDevice` 并传给每个图表：

```ts
import { Charturbo, CharturboDevice } from 'charturbo';

const device = await CharturboDevice.create();
for (const row of rows) {
  const sdk = await Charturbo.create(row.canvas, { device });
  sdk.renderSparkline(row.values, { type: 'area', band: [95, 105], label: row.name });
  sdk.render();
}
// 清理：先 dispose 每个 sdk，再调用 device.dispose()
```

后端、WebGL2 行为和限制见[共享 GPU 设备](../guide/shared-device)。

## 说明

- 最后 / 最小 / 最大值标记、参考带和胜负图的零线都是引擎（Rust）标记，只在 GPU 上绘制。
- 不支持缩放、平移和键盘导航。
- 胜负柱的胜使用调色板第一个颜色，负使用第二个颜色，并绘制零线。
- 在 React / Vue 组件中，`type: 'sparkline'` 默认关闭交互。见 [React](../guide/react) 和 [Vue](../guide/vue)。

## 另请参阅

- [共享 GPU 设备](../guide/shared-device)
- [折线图](./line)
- [面积图](./area)
- [实时数据流](../guide/streaming)
- [无障碍](../guide/accessibility)
