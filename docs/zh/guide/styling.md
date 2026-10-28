# 样式与主题

主题设置 GPU 图形和 DOM 覆盖层共用的颜色：背景、系列调色板、网格线、文字和提示框。在此基础上，各图表选项设置系列颜色、标题、图例、网格、内边距和线宽。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 内置主题

```ts
import { Charturbo, CHARTURBO_THEMES } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.setTheme('light');          // 'dark'（默认）| 'light'
sdk.getTheme().name;            // 'light'
CHARTURBO_THEMES.dark.palette;  // RgbaTuple[]
```

每个内置调色板都是 8 种颜色的序列，并已针对各自的背景通过色觉障碍区分度验证。

## 自定义主题

展开现有主题后覆盖所需的令牌即可。GPU 颜色令牌（`surface`、`palette`、`grid`、`baseline`、`crosshair`）也接受 CSS 颜色字符串。

```ts
sdk.setTheme('light');
sdk.setTheme({
  ...sdk.getTheme(),
  name: 'brand',
  surface: '#faf6ed',
  palette: ['#3182f6', '#14b8a6', '#f59e0b'],
  textPrimary: '#14213d',
  fontFamily: 'system-ui, sans-serif',
});
sdk.renderBarChart(
  [
    { label: 'A', value: 32, color: '#3182f6' },
    { label: 'B', value: 18, color: '#14b8a6' },
  ],
  { orientation: 'horizontal', cornerRadius: 8, labels: true }
);
sdk.render();
```

主题令牌（`CharturboTheme`）：

| 令牌 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 主题名称 |
| `surface` | `RgbaTuple` | 画布清屏色 |
| `palette` | `RgbaTuple[]` | 系列颜色顺序 |
| `grid` | `RgbaTuple` | 网格线 |
| `baseline` | `RgbaTuple` | 基线；线 / 点标注的默认颜色 |
| `crosshair` | `RgbaTuple` | 十字准线；区间标注的默认颜色 |
| `textPrimary` | `string` | 标题、标签 |
| `textSecondary` | `string` | 次要文字 |
| `textMuted` | `string` | 弱化文字 |
| `tooltipBackground` | `string` | 提示框与标签胶囊的背景 |
| `tooltipBorder` | `string` | 提示框与标签胶囊的边框 |
| `fontFamily` | `string` | DOM 覆盖层（标题、图例、刻度、标签、提示框）的字体 |

即使 GPU 令牌以 CSS 字符串传入，`getTheme()` 也会以元组形式返回。

## setTheme 会更新什么

`setTheme` 会更新背景、文字、网格线、提示框、标注默认颜色、范围选择器，以及各图表类型基于主题的样式（饼图、热力图、商业图表和层级图表的调色板等），并触发 `'themechange'`。

传给 render 调用的显式系列 / 数据项颜色会保留。若也要更改这些颜色，请用新选项再次调用 `render*Chart()`，然后调用 `render()`。

[基准测试页面](https://jparkk0517.github.io/Charturbo/benchmarks.html)以这种方式切换主题、强调色、调色板、字体、圆角和标签。其中 Midnight 和 Paper 主题是示例中的自定义主题；SDK 内置的字符串主题只有 `'light'` 和 `'dark'`。

## 系列颜色

```ts
sdk.renderLineChart([
  { name: 'cpu', values: cpu, color: '#3b82f6' },
  { name: 'mem', values: mem, color: [0.94, 0.35, 0.33, 1] },
  { name: 'net', values: net }, // 下一个调色板颜色
]);
```

所有颜色选项都接受 `ColorInput`：

- 0..1 范围的 `[r, g, b, a]` 元组；
- `'#rgb'`、`'#rgba'`、`'#rrggbb'`、`'#rrggbbaa'`、`rgb()` / `rgba()`、`hsl()` / `hsla()`，无需 DOM 即可解析；
- 其他 CSS 颜色（命名颜色等），在存在 `document` 时通过 2D 画布解析。

无效字符串会抛出 `TypeError`。解析函数以 `parseColor` 导出。

## 标题与图例

```ts
sdk.renderLineChart(series, {
  title: '基础设施遥测',
  legend: { show: true, toggle: true, emphasize: true },
});
sdk.setSeriesVisible(1, false); // 等同于点击图例
sdk.emphasizeSeries(0);         // 淡化其他系列（null 为取消）
```

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | `string` | — | 绘图区上方的图表标题 |
| `legend` | `boolean \| ChartLegendOptions` | 2 个及以上系列时显示 | `true` / `false` 或下列对象 |
| `legend.show` | `boolean` | 2 个及以上系列时为 `true` | 显示图例 |
| `legend.toggle` | `boolean` | `true` | 点击切换系列可见性 |
| `legend.emphasize` | `boolean` | `true` | 悬停时淡化其他系列 |

图例项是 `<button aria-pressed>` 元素，因此可用键盘操作。切换时触发 `'legendtoggle'`。

## 网格

```ts
sdk.renderLineChart(series, { showBackdropGrid: true, grid: { rows: 4, strokeWidth: 1 } });
sdk.setChartGrid(true, { rows: 4, color: '#e5e7eb' }); // 渲染后
```

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `showBackdropGrid` | `boolean` | `true` | 水平网格线和基线 |
| `grid.rows` | `number` | `5` | 水平网格间隔数 |
| `grid.color` | `ColorInput` | 主题 `grid` | 网格线颜色 |
| `grid.baselineColor` | `ColorInput` | 主题 `baseline` | 基线颜色 |
| `grid.strokeWidth` | `number` | `1` | 线宽，CSS px |
| `verticalGrid` | `boolean` | `true` | 仅散点图：在 x 刻度处绘制竖直网格线 |

## 内边距

```ts
sdk.renderLineChart(series, { padding: { right: 24 } });
```

`padding`（`top`、`right`、`bottom`、`left`，CSS px）设置绘图区边距。省略的边会根据标题、图例和坐标轴自动计算。

## 线宽

```ts
sdk.renderLineChart(series, { lineWidth: 2 }); // 所有系列，CSS px（默认 2）
sdk.setLineWidth(1.5);    // 渲染后：所有系列
sdk.setLineWidth(4, 0);   // 仅系列 0
```

系列的 `lineWidth` 优先于图表值。线宽在任何缩放级别下保持不变。标记、虚线和曲线见[折线图](../charts/line)。

## CSS 类

覆盖层是普通 DOM，可以用 CSS 设置样式：

| 类 | 元素 |
|---|---|
| `.charturbo-sdk-chart-overlay` | 画布上方的覆盖层根元素 |
| `.charturbo-sdk-chart-title` | 标题 |
| `.charturbo-sdk-chart-legend`、`.charturbo-sdk-legend-item` | 图例及其项 |
| `.charturbo-sdk-axis-tick`、`.charturbo-sdk-axis-title` | 刻度标签和坐标轴标题 |
| `.charturbo-sdk-annotation-label` | 标注标签 |
| `.charturbo-sdk-node-tooltip` | 提示框 |

## 另请参阅

- [提示框与悬停](./tooltips)：悬停层样式
- [标注](./annotations)
- [导出：PNG · SVG · PDF](./export)
- [无障碍](./accessibility)
