# 提示框与悬停

悬停在图表上时会显示 GPU 悬停层（十字准线、数据点标记、高亮柱）和 DOM 提示框。本页介绍提示框选项、自定义提示框 HTML、悬停样式和悬停事件。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 基本用法

启用交互后即显示内置提示框：

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { hover: { mode: 'index', crosshair: true } });
sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  tooltip: {
    sort: 'desc',            // 'none'（默认，系列顺序）| 'asc' | 'desc'
    shared: true,            // 悬停 x 处的所有系列（默认）
    pin: 'click',            // 点击固定提示框
    valueFormatter: '$,.2f', // 格式说明符、Intl 选项或函数
  },
});
sdk.render();
```

## 提示框选项

影响提示框的 `enableNodeInteractions` 选项：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `builtInTooltip` | `boolean` | `true` | 显示浮动提示框 |
| `tooltipContainer` | `HTMLElement` | `canvas.parentElement` 或 `document.body` | 提示框挂载的元素 |
| `tooltip.sort` | `'none' \| 'asc' \| 'desc'` | `'none'` | 按值排序行；`NaN` 排在最后 |
| `tooltip.shared` | `boolean` | `true` | `true`：悬停 x / 类目处的所有系列。`false`：仅显示离指针最近的一项 |
| `tooltip.pin` | `'click' \| false` | `false` | 点击悬停项以固定提示框 |
| `tooltip.valueFormatter` | 格式说明符、`Intl.NumberFormatOptions` 或 `(v) => string` | y 轴 `format` 或本地化数字 | 默认提示框中的数值 |
| `formatChartTooltip` | `(ctx: ChartTooltipContext) => string` | — | 图表提示框的自定义 HTML |
| `formatTooltip` | `(details: NodeDetails) => string` | — | 网络图 / 点云节点提示框的自定义 HTML |
| `tooltipClassName` | `string` | — | 额外的 class；基础 class 为 `charturbo-sdk-node-tooltip` |
| `tooltipStyle` | `Partial<CSSStyleDeclaration>` | — | 合并到默认样式之上的内联样式 |

- `sort` 和 `shared` 仅影响展示。引擎命中测试结果不变，`'hover'` / `'click'` 事件仍接收原始顺序和全部项。`formatChartTooltip` 接收排序和过滤后的上下文。
- `shared: false` 只减少折线图、面积图、堆叠柱状图和组合图提示框的行数。GPU 标记仍保留在所有系列上；若标记也只需一个，请使用 `hover: { mode: 'nearest' }`。
- `valueFormatter` 作用于系列值、合计、OHLC、热力图单元格、箱线统计、饼图数值和散点 y。它只作用于默认提示框，不作用于 `formatChartTooltip`。说明符语法见[数字与日期格式](./number-format)。

## 固定

设置 `pin: 'click'` 后，点击悬停项会将提示框和引擎悬停（十字准线、标记）固定在该处。被固定的元素带有 `data-pinned="true"`，指针移动、离开画布或联动光标都不会改变它。

以下操作会解除固定：再次点击、在画布外 `pointerdown`、Escape（画布获得焦点时）、滚轮缩放或拖动平移、键盘移动数据点，以及渲染新图表。点击空白处不会固定。解除时，`'hover'` 事件和 `onNodeHover` 会收到 `null`。

在触摸设备上，轻点会在该点固定提示框直到下一次轻点，长按则进入拖拽查看（见[交互](./interactions#touch-and-pen)）。

::: warning 注意
固定期间，[联动组](./dashboard-sync)的光标（`hoverAtX`）仍会移动引擎标记，只有提示框保持固定。
:::

## 自定义提示框 HTML

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  formatChartTooltip: (ctx) =>
    `<b>${escapeHtml(ctx.xLabel)}</b>` +
    ctx.items
      .map((it) => `<div style="color:${it.color}">${escapeHtml(it.seriesName)}: ${it.value}</div>`)
      .join(''),
  tooltipClassName: 'my-tooltip',
  tooltipStyle: { background: '#fff', color: '#111' },
});
```

::: warning 注意
返回的字符串会作为 `innerHTML` 插入。来自数据的所有字符串（系列名、标签、元数据）都应使用导出的 `escapeHtml` 包裹。默认提示框已自动转义。
:::

`ChartTooltipContext` 的主要字段：

| 字段 | 说明 |
|---|---|
| `chartType` | `'line'`、`'bar'`、`'scatter'`、`'candlestick'`、`'heatmap'`、`'box'`、`'pie'`、`'combo'`、…（面积图报告 `'line'`） |
| `index` | 悬停的样本 / 柱 / 点的索引 |
| `xLabel` | 格式化后的 x（折线图）、类目标签（柱状图）、格式化后的 x（散点图） |
| `x` | 主样本的系列 `x`（带 `x` 的折线图） |
| `items` | 每行一个 `{ seriesName, value, color, nodeId, percent?, error?, band? }` |
| `total` | 堆叠柱状图 / 面积图：可见系列之和 |
| `areaMode` | 面积图：`'overlap' \| 'stacked' \| 'percent'` |
| `point` | 散点图：悬停点的数据坐标 |
| `ohlc` | K 线图：开盘 / 最高 / 最低 / 收盘 / 成交量 |
| `cell` | 热力图：`{ row, col, xLabel, yLabel }` |
| `slice` | 饼图：`{ label, value, percent, members? }` |
| `box` | 箱线图统计量 |
| `details` | 主数据点（离指针最近）的 `NodeDetails` |

商业图表和层级图表还会添加各自的字段（`radar`、`gauge`、`funnel`、`waterfall`、`hierarchy`、`flow`）。

## 悬停样式

`hover` 图表选项（渲染后使用 `setChartHoverStyle`）设置 GPU 悬停层的样式。颜色为 `ColorInput`：0..1 范围的 `[r, g, b, a]` 元组或 CSS 颜色字符串。

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mode` | `'index' \| 'nearest'` | `'index'` | `'index'`：悬停 x 处的所有系列。`'nearest'`：仅最近的一个点（2.5D 视图始终为 `'nearest'`） |
| `crosshair` | `boolean` | `true` | 2D 折线图的竖直参考线 |
| `crosshairColor` | `ColorInput` | `[0.58, 0.64, 0.72, 0.55]` | 十字准线颜色 |
| `crosshairWidth` | `number` | `1` | 十字准线宽度，CSS px |
| `marker` | `boolean` | `true` | 使用系列颜色的数据点标记 |
| `markerRadius` | `number` | `4` | 标记半径，CSS px（不含外环） |
| `markerRingColor` | `ColorInput` | 图表背景色 | 将标记与折线分开的外环 |
| `markerRingWidth` | `number` | `2` | 外环宽度，CSS px |
| `hitRadius` | `number` | `24`（散点图：`12`） | `'nearest'` 模式的拾取半径，CSS px |
| `barHighlightColor` | `ColorInput` | 柱颜色提亮 22% | 悬停柱的颜色 |

```ts
sdk.setChartHoverStyle({ mode: 'nearest', markerRadius: 6 });

// 网络图 / 点云节点（默认：自身颜色提亮，半径 1.6 倍）
sdk.setNodeHoverStyle({ scale: 1.4, color: [1, 1, 1, 1] });
```

## 悬停事件

```ts
sdk.on('hover', ({ chart, node }) => {
  if (!chart) return hideSidePanel(); // 指针已离开
  showSidePanel(chart.xLabel, chart.items);
});
```

`chart` 与上文相同，为 `ChartTooltipContext`，但未经排序和过滤。`'hover'` 和 `onNodeHover` 都需要 `enableNodeInteractions`。

## 以代码悬停

```ts
sdk.hoverAtX(Date.parse('2026-01-01T09:00Z'), { tooltip: true }); // 如同指针停在该 x
sdk.getHoverX();  // 当前悬停的数据 x，或 null
sdk.hoverAtX(null); // 清除
sdk.render();
```

`hoverAtX` 以 index 模式悬停（柱状图：`round(x)` 处的类目），且不触发 `'hover'`。`tooltip: true` 时同时显示内置提示框。[仪表盘联动](./dashboard-sync)即使用此方法。

## 本地化标签

默认提示框数值使用图表区域设置（`locale` 选项，其次 `setLocale`，再次运行时区域设置）。Open / High / Low / Close / Volume 等内置字段标签也遵循同一区域设置（en、ko、zh-CN；其他回退为英文）。详见[国际化](./i18n)。

## 另请参阅

- [交互](./interactions)
- [数字与日期格式](./number-format)
- [样式与主题](./styling)：提示框颜色来自主题
