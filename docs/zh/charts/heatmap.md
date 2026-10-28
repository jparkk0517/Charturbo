# 热力图

热力图为数值网格中的每个单元格着色。网格作为浮点纹理只上传一次，并以单个四边形绘制，因此最大 4096 × 4096 个单元格的网格依然可以流畅交互。适用于矩阵、日历（日 × 小时）以及密集的 2D 数据。

[在线示例](https://jparkk0517.github.io/Charturbo/heatmap.html)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const cols = 90; // 天
const rows = 24; // 小时
const values = new Float32Array(cols * rows); // values[row * cols + col]
// ... 填充 values

sdk.renderHeatmap(
  {
    cols,
    rows,
    values,
    xLabels: Array.from({ length: cols }, (_, c) => `第 ${c + 1} 天`),
    yLabels: Array.from({ length: rows }, (_, r) => `${String(r).padStart(2, '0')}:00`),
  },
  { title: '按小时统计的负载', valueLabel: '负载', colorScale: 'sequential', colorbar: { title: 'req/s' } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderHeatmap(data: HeatmapChartData, options?: HeatmapChartOptions): { cellCount: number }
```

数据点 id = `row * cols + col`。

## 数据格式 {#data-format}

`HeatmapChartData`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `cols` | `number` | 列数。 |
| `rows` | `number` | 行数。 |
| `values` | `Float32Array \| number[]` | 按行优先排列的值，`values[row * cols + col]`。`NaN` = 空单元格。最大 4096 × 4096。 |
| `xLabels` | `string[]` | 列标签：类别 x 轴（刻度值 = 列索引）。 |
| `yLabels` | `string[]` | 行标签：类别 y 轴（刻度值 = 行索引）。 |
| `xExtent` | `[number, number]` | 改用数值 x 轴：网格左右边缘对应的数据 x。 |
| `yExtent` | `[number, number]` | 改用数值 y 轴：网格上下边缘对应的数据 y。 |

类别标签会被抽稀，以免相互重叠。

## 选项 {#options}

`HeatmapChartOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `title` | `string` | — | 图表标题。 |
| `description` | `string` | — | canvas 的无障碍名称。 |
| `colorScale` | `'sequential' \| 'viridis' \| 'magma' \| 'diverging'` | `'sequential'` | 色图。`'sequential'` 是从浅到深的单一色相；`'diverging'` 以 `center` 为中心使用两种色相。 |
| `color` | `ColorInput` | 参考蓝色渐变 | 顺序色阶的色相来源。 |
| `reverse` | `boolean` | `false` | 首尾翻转色图。 |
| `min` | `number` | 数据最小值 | 值域下限。 |
| `max` | `number` | 数据最大值 | 值域上限。 |
| `center` | `number` | 数据跨越 0 时为 `0`，否则为值域中点 | 发散色阶的中点。未设置 `min` / `max` 的发散色阶以该点为中心对称。 |
| `emptyColor` | `ColorInput` | 透明 | `NaN` 单元格的颜色。 |
| `rowOrder` | `'top-down' \| 'bottom-up'` | `'top-down'` | `'top-down'`：第 0 行位于顶部（矩阵顺序）。`'bottom-up'`：第 0 行位于底部。 |
| `colorbar` | `HeatmapColorbarOptions \| boolean` | 显示 | 绘图区右侧的颜色条：`{ show, title, format }`。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 值在提示框和颜色条中的名称。 |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | 坐标轴标题和格式。 |
| `hover` | `ChartHoverStyle` | — | 单元格轮廓：`markerRingColor`（外圈）、`barHighlightColor`（内圈）；`marker: false` 关闭轮廓。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距，单位为 CSS px。 |
| `width` | `number` | `160` | 绘图区的世界坐标宽度。 |
| `height` | `number` | `90` | 绘图区的世界坐标高度。 |

`HeatmapColorbarOptions`：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `show` | `boolean` | `true` | 显示颜色条。 |
| `title` | `string` | `valueLabel` | 颜色条上方的简短标签。 |
| `format` | `(value: number) => string` | 紧凑数字 | 刻度标签文字。仅支持函数（不支持格式说明字符串）。 |

颜色条由 DOM 绘制，并包含在 PNG 导出中。

## 色图 {#colormaps}

引擎使用 OKLab 插值构建一个 256 项的查找表。片元着色器读取每个单元格的值，按 `min` / `max`（或围绕 `center`）归一化，然后从 LUT 中选取颜色。`'sequential'` 和 `'diverging'` 的两端会随主题表面亮度翻转。

渲染后可以修改色图或值域，而无需重新上传网格：

```ts
sdk.setHeatmapColorScale('diverging');                 // 只重新上传 1 KB 的 LUT
sdk.setHeatmapColorScale('sequential', { color: '#2a78d6', reverse: true });
sdk.setHeatmapDomain({ min: -5, max: 5, center: 0 }); // 只更新 uniform
sdk.render();
```

| 方法 | 说明 |
|---|---|
| `setHeatmapColorScale(scale, options?)` | 切换色图。`options`：`{ color?, reverse?, emptyColor? }`；`undefined` 保留已存储的设置。 |
| `setHeatmapDomain({ min?, max?, center? })` | 修改值域。省略的值从数据中计算。 |

## 交互 {#interactions}

- 滚轮和拖动可缩放和平移两个坐标轴；双击重置。`zoomChartXY` 可在代码中使用。
- 悬停是 O(1) 的单元格计算。它会描出单元格轮廓；提示框显示行、列和值（`ctx.cell = { row, col, xLabel, yLabel }`）。
- 热力图不支持刷选：`'select'` 的载荷始终为空。

见[交互](../guide/interactions)和[提示框与悬停](../guide/tooltips)。

## 更新数据 {#updating-data}

用新的网格再次调用 `renderHeatmap`。修改色图或值域时，请使用上述方法。

## 注意事项 {#notes}

- 大于设备 2D 纹理上限的网格会按行优先折行写入纹理。
- `xExtent` 不是时间轴：时区不适用。

## 框架 {#frameworks}

```tsx
<CharturboChart type="heatmap" data={{ cols, rows, values }} options={{ colorScale: 'viridis' }} />
```

## 另请参阅 {#see-also}

- [散点图 · 气泡图](./scatter)
- [样式与主题](../guide/styling)
- [导出：PNG · SVG · PDF](../guide/export)
