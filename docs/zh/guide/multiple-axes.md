# 多坐标轴与坐标轴断裂

折线图和组合图可以显示三个以上的 y 轴；数值轴可以折叠没有数据的区间（坐标轴断裂）。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 三个以上的 y 轴

每个系列用 `yAxisIndex` 选择坐标轴：`0` 为 `axes.y`（左），`1` 为 `axes.y2`（右），`2..` 为 `axes.extraY[k - 2]`。`yAxisIndex` 优先于 `yAxis: 'left' | 'right'`。

```ts
sdk.renderLineChart(
  [
    { name: 'Temperature', x, values: temp },
    { name: 'Rain', x, values: rain, yAxis: 'right' },
    { name: 'Pressure', x, values: pressure, yAxisIndex: 2, color: '#c2410c' },
  ],
  {
    axes: {
      y: { title: '气温 (°C)' },
      y2: { title: '降雨 (mm)', min: 0 },
      extraY: [{ title: '气压 (hPa)', color: '#c2410c', format: (v) => v.toFixed(0) }],
    },
  }
);
```

每个附加轴都有自己的选项：`min` / `max`、`autoscale`、`scale`（`'linear'` / `'log'`）、`format`、`title`、`tickCount`、`breaks`，以及位置：

| 选项 | 默认值 | 含义 |
|---|---|---|
| `position` | `'right'` | 位于绘图区哪一侧；在该侧已有坐标轴之外向外堆叠 |
| `offset` | `0` | 与同侧前一个坐标轴之间的额外间距（CSS px） |
| `color` | 主题 | 标签、标题和轴线的颜色 |
| `show` | `true` | `false` 时隐藏标签，保留坐标轴比例 |

- **边距：** 边距会自动扩大，以容纳附加标签区域和标题。
- **缩放：** x 缩放和平移作用于所有系列，每个 y 轴各自自动缩放。
- **网格线：** 网格线跟随左轴。
- **提示框：** 每个数值按其所在坐标轴的 `format` 显示。
- **数量上限：** 最多 6 个附加轴（共 8 个 y 轴）。
- **错误：** 没有对应坐标轴的 `yAxisIndex` 会在清除当前图表之前抛出错误。

组合图接受相同的选项（`ComboChartOptions.axes.extraY` 中的 `min`、`max`、`nice`、`position`、`offset`、`color`）。所有柱状系列共用第一个柱状系列的坐标轴。

```ts
sdk.renderComboChart(
  {
    categories: weeks,
    series: [
      { name: 'Volume', type: 'bar', values: volume },
      { name: 'Price', type: 'line', yAxis: 'right', values: price },
      { name: 'RSI', type: 'line', yAxisIndex: 2, values: rsi },
    ],
  },
  { axes: { extraY: [{ title: 'RSI', position: 'left', min: 0, max: 100, nice: false }] } }
);
```

坐标轴过多容易让读者比较互不相关的比例。除非系列之间确有关联，否则建议拆成多个图表。

## 坐标轴断裂

`breaks` 把数值区间折叠为小间隙，并在坐标轴和整个绘图区上用锯齿线标出：

```ts
sdk.renderBarChart(items, {
  axes: { y: { breaks: [{ start: 40, end: 430, gap: '8%' }] } },
});
```

| 字段 | 含义 |
|---|---|
| `start`、`end` | 折叠的数值区间（`start < end`） |
| `gap` | 区间保留的宽度：数据单位，或坐标轴保留数据跨度的 `'<n>%'`。默认 `'2%'` |

支持范围：

| 图表 | 坐标轴 |
|---|---|
| 折线 | `axes.y`、`axes.y2`、`axes.extraY[i]` |
| 面积 | `axes.y` |
| 组合 | `axes.y`、`axes.y2`、`axes.extraY[i]` |
| 柱状（单系列及分组 / 堆叠 / 百分比） | 数值轴（`axes.y`，水平柱为 `axes.x`） |
| 散点 | `axes.x` 和 `axes.y` |

- **引擎：** 分段映射位于 Rust 比例尺中，几何、刻度、悬停、刷选和缩放都使用它。
- **刻度：** 刻度跳过折叠区间。
- **断裂内的数据：** 断裂内的数据绘制在间隙处，并在提示框、数据表和 CSV 中保留真实数值。
- **导出：** PNG 和 SVG 导出包含锯齿标记。
- **屏幕阅读器：** 描述会列出每个断裂。

规则（在清除当前图表之前检查）：

- 每个坐标轴最多 8 个断裂，区间不能重叠或相接
- 仅限线性比例尺：`log` 轴上的断裂会抛出错误；对有断裂的坐标轴调用 `setAxisScale(axis, { scale: 'log' })` 同样抛出错误
- 柱状图误差线不能与断裂同时使用
- 象形柱图以及折线 / 面积图的 x 轴不支持断裂

## 无障碍

屏幕阅读器描述会按图表语言说明每个附加轴及其系列（“附加 Y 轴（Pressure）：Pressure。”）和每个断裂（“Y 轴：省略 40–430 区间。”）。
