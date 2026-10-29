# 主题河流图

`renderThemeRiverChart` 绘制流图（ECharts `themeRiver`）：每个名称一条河流，围绕移动的基线堆叠，使整体形状保持平滑。适合展示主题、类别或来源的构成随时间的变化。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html#13-theme-river)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderThemeRiverChart(
  [
    ['2026-01-01', 12, 'Rust'],
    ['2026-01-02', 18, 'Rust'],
    ['2026-01-01', 7, 'WebGPU'],
    ['2026-01-02', 11, 'WebGPU'],
  ],
  { title: '各主题提及次数' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderThemeRiverChart(
  data: readonly ThemeRiverDatum[],
  options?: ThemeRiverChartOptions
): { totalPoints: number; seriesCount: number }
```

## 数据格式 {#data-format}

```ts
type ThemeRiverDatum = readonly [x: number | Date | string, value: number, name: string];
```

- 行按 `name` 分组。河流按首次出现的顺序堆叠（第一个名称在最下方）。
- 所有河流的 x 值合并后排序。某条河流在某个 x 上没有行时，该处为 0。x 和名称相同的行会相加。
- `x` 为数字、`Date` 或日期字符串（`Date.parse`）。使用 `Date` 或字符串 x 时，x 轴为时间轴。
- `value` 必须为有限值且 `>= 0`，`x` 必须为有限值，否则抛出异常。

`themeRiverSeries(data, options)` 返回分组后的河流，不进行渲染。

## 选项 {#options}

`ThemeRiverChartOptions` 接受除 `viewMode` 和 `nulls` 之外的所有[折线图选项](./line#options)，另外还有：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `offset` | `'wiggle' \| 'silhouette' \| 'zero'` | `'wiggle'` | 基线。`'wiggle'` 使河流的加权摆动最小（d3 `stackOffsetWiggle`）。`'silhouette'` 使堆叠以 0 为中心。`'zero'` 为普通堆叠。 |
| `order` | `'none' \| 'insideOut'` | `'none'` | 堆叠顺序。`'none'` 保持输入顺序。`'insideOut'` 将较早到达峰值的河流放在中间，较晚的放在外侧（d3 `stackOrderInsideOut`）。 |
| `smooth` | `boolean` | `true` | 平滑（monotone）的河流边缘。`false` 时绘制直线段。 |
| `colors` | `Record<string, ColorInput> \| ColorInput[]` | 主题调色板 | 按名称或按河流顺序指定的颜色。 |
| `fillOpacity` | `number` | `0.85` | 河流颜色的填充透明度倍数。 |
| `labels` | `boolean \| { show?: boolean; minHeight?: number }` | 显示 | 每条河流左端的名称。该处比 `minHeight` CSS px（默认 12）更细的河流不显示标签；与更粗河流的标签重叠的标签会被省略。 |

y 轴和网格线默认隐藏（`axes.y.show: true` 可显示）。`axes.y.autoscale: 'visible'` 按 `'all'` 处理，以保证整条河流可见。基线数值与 d3 一致。

## 图例与提示框 {#legend-and-tooltips}

- 点击图例项会隐藏该河流，引擎重新堆叠其余河流并重新计算基线。
- 悬停时显示该 x 上的所有河流及合计（`ctx.total`）；`ctx.chartType` 为 `'themeRiver'`。指针下的河流为主项并被突出显示，其余河流变淡。

参见[提示框与悬停](../guide/tooltips)。

## 更新数据 {#updating-data}

使用 `appendAreaData` 流式追加新样本：每条河流一个数据块，按河流顺序（首次出现顺序）传入，且 x 相同。

```ts
sdk.appendAreaData(
  [{ values: [14], x: [nextDay] }, { values: [9], x: [nextDay] }],
  { maxPoints: 365 }
);
sdk.render();
```

每次更新都会基于保留的全部样本重新计算基线。规则参见[面积图](./area#updating-data)。

## 无障碍与导出 {#accessibility-and-export}

与面积图一样提供摘要、数据表和键盘导航。CSV 导出列出原始河流数值；SVG 和 PNG 导出包含河流标签。React 和 Vue 组件接受 `type: 'themeRiver'` 以及 `data`、`options`。

## 另请参阅 {#see-also}

- [面积图](./area)
- [折线图](./line)
- [实时流式数据](../guide/streaming)
