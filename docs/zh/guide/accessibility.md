# 无障碍

SDK 渲染的每个图表都会附带文本摘要、供屏幕阅读器使用的详细描述和数据点键盘导航，并可按需显示无障碍数据表格、导出 CSV。无需额外开启：为图表设置 `title`，自动摘要不够用时再设置 `description`。

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const rps = Float32Array.from({ length: 5_000 }, (_, i) => 100 + Math.sin(i / 300) * 50);
sdk.renderLineChart([{ name: 'AI-Inference-RPS', values: rps }], {
  title: '推理流量',
  description: '发布后 RPS 翻倍', // 可选：代替自动摘要作为 aria-label
});
sdk.enableNodeInteractions(canvas, { autoRender: true }); // 键盘聚焦的数据点同样显示提示框
sdk.render();

sdk.getChartSummary(); // "推理流量. ..."（自动摘要）
```

## 画布上的属性

| 属性 / 元素 | 值 |
|---|---|
| `role` | `img` |
| `aria-label` | 自动摘要（图表类型、系列数与数据点数、取值范围）。设置了 `description` 时使用该句，摘要移入详细描述。 |
| `aria-describedby` | 视觉上隐藏的元素：坐标轴范围、各系列的最小值 / 最大值 / 平均值 / 趋势，以及键盘说明。 |
| `tabindex` | 有图表时为 `0`，可用 Tab 键聚焦画布。 |
| 实时区域 | 视觉上隐藏的 `aria-live="polite"` 元素，朗读当前聚焦的数据点，例如 `"T+120, AI-Inference-RPS 135.9."` |

`sdk.getChartSummary()` 返回与 `aria-label` 相同的文本。移除图表或释放 SDK 时，画布原有的属性会被恢复。

## 键盘导航

聚焦画布后：

| 按键 | 操作 |
|---|---|
| ← / → | 上一个 / 下一个样本（柱状图：类别；散点图：同一系列中按 x 顺序的下一个点；K 线图：K 线；饼图：扇区；热力图：列） |
| PageUp / PageDown | 跳过 10 个（饼图除外） |
| Home / End | 第一个 / 最后一个样本（散点图：最小 / 最大 x） |
| ↑ / ↓ | 切换系列，跳过隐藏的系列（热力图：行；单系列柱状图、K 线图、饼图无此操作） |
| Enter | 矩形树图 / 旭日图：下钻到聚焦的节点 |
| Esc | 清除聚焦（矩形树图 / 旭日图：返回上一层） |

与 Alt、Ctrl 或 ⌘ 同时按下的键会被忽略，因此 Ctrl + Z 等缩放快捷键照常可用。

聚焦的数据点使用与指针相同的引擎悬停效果（十字准线、标记、柱子高亮）。开启 `enableNodeInteractions` 时，内置提示框（包括自定义的 `formatChartTooltip`）也会显示在该点上。

## 数据表格与 CSV

```ts
sdk.showDataTable(document.querySelector('#table')!, { maxRows: 1000 }); // 不传容器时插入到画布容器之后
sdk.hideDataTable();

const table = sdk.getChartDataTable(); // { columns, rows, totalRows, sampled }，默认为完整数据
const csv = sdk.exportChartCSV();      // RFC 4180 CSV，行以 CRLF 分隔
```

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `maxRows` | `number` | `showDataTable` 为 `1000`；`getChartDataTable` 不限 | 超出时均匀抽样，保留首行和末行。 |
| `maxColumns` | `number` | `showDataTable` 为 `50`；`getChartDataTable` 不限 | 仅热力图：数值列，按同样方式抽样。 |

- 表格带有 `<caption>`（图表标题）以及 `<th scope="col">` / `<th scope="row">` 表头。滚动容器为 `role="region"` 且可聚焦，键盘用户也能滚动。
- 抽样后的表格会附带说明文字。`getChartDataTable()` 通过 `sampled` 标明（热力图还有 `sampledColumns` / `totalColumns`）。
- 已打开的表格会在图表重新渲染或主题变化时自动刷新。
- `exportChartCSV()` 始终写出完整数据。电子表格会当作公式执行的文本单元格（以 `=`、`+`、`-`、`@` 开头）前面会加上 `'`；数字原样写出。
- 4096 × 4096 的热力图有 1,600 万个单元格：请给 `getChartDataTable` 传入 `maxRows` / `maxColumns`，或使用 `exportChartCSV()`。

## 语言

摘要、详细描述、键盘说明、实时朗读内容和数据表格表头都跟随 SDK 区域设置：`Charturbo.create(canvas, { locale })` 或 `sdk.setLocale(locale)`。内置语言为英语（`en`）、韩语（`ko`）和简体中文（`zh-CN`）；其他区域设置回退到英语，`undefined` 使用浏览器语言。数字和日期也使用同一区域设置的 `Intl` 格式。参见[国际化](./i18n)。

## 高对比度与减少动态效果

- 在 `forced-colors: active`（Windows 高对比度）下，图例色块带 `CanvasText` 边框并保留系列颜色（`forced-color-adjust: none`），隐藏的系列为虚线边框，画布焦点环使用 `Highlight`。提示框和数据表格单元格也带 `CanvasText` 边框。
- 键盘焦点环为当前文字颜色的 2 px `:focus-visible` 轮廓线。
- 无障碍层本身不使用过渡效果。图表[动画](./animation)需要主动开启，并且在 `prefers-reduced-motion: reduce` 下会关闭。

## 各图表的行为

- **散点图**：摘要列出各系列的点数和 x / y 范围；表格每个点一行（x、y、系列），按数据顺序排列。
- **桑基图**：摘要给出节点数、列数、连线数和最大流量；表格每条连线一行（源、目标、值、占源的比例）；← / → 在连线之间移动。
- **矩形树图 / 旭日图**：与指针操作相同，Enter 下钻到聚焦的节点，Esc 返回上一层。
- **迷你图**：精简模式。画布只有 `role="img"` 和描述趋势的 `aria-label`（例如 `"Revenue: trend up 12% from 100 to 112, min 95, max 120"`），没有详细描述、实时区域和 `tabindex`。名称通过 `label` 选项设置。参见[迷你图](../charts/sparkline)。

## 限制

- 缩放后位于视野之外的点仍会朗读，但会清除悬停效果。
- 在屏幕阅读器的浏览模式下，方向键由阅读器接管。请切换到焦点 / 表单模式来浏览图表。

## 另请参阅

- [国际化](./i18n)
- [提示框与悬停](./tooltips)
- [交互](./interactions)
- [导出：PNG · SVG · PDF](./export)
