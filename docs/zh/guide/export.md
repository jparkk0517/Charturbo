# 导出：PNG · SVG · PDF

可将图表保存为合成了 DOM 标签的位图（PNG、JPEG、WebP）、由引擎图元生成的矢量 SVG、单页 PDF，或复制到剪贴板。即使动画正在播放，导出的也始终是最终帧。

[在线示例](https://jparkk0517.github.io/Charturbo/export.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderGroupedBarChart(
  {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: '北区', values: [10, 22, 31, 40] },
      { name: '南区', values: [6, 15, 12, 22] },
    ],
  },
  { title: '季度营收' }
);
sdk.render();

await sdk.downloadImage('revenue.png', { pixelRatio: 2 }); // 2 倍分辨率 PNG
sdk.downloadChartSVG('revenue.svg');                      // 矢量 SVG
await sdk.downloadChartPDF('revenue.pdf');                // 单页 PDF（位图）
const copied = await sdk.copyChartImage();                // PNG 写入剪贴板；不支持时为 false
```

## 方法

| 方法 | 返回值 | 说明 |
|---|---|---|
| `toImage(options?)` | `Promise<Blob>` | 画布与 DOM 覆盖层合成的图片。 |
| `toDataURL(options?)` | `Promise<string>` | 以 `data:` URL 形式返回 `toImage` 的结果。 |
| `downloadImage(filename = 'chart.png', options?)` | `Promise<void>` | 下载 `toImage`。未设置 `options.format` 时按扩展名确定格式（`.jpg` / `.jpeg`、`.webp`，其余为 PNG）。 |
| `exportChartSVG(options?)` | `string` | 同步返回矢量 SVG 文档。 |
| `downloadChartSVG(filename = 'chart.svg', options?)` | `void` | 下载 `exportChartSVG()`。 |
| `toPDF(options?)` | `Promise<Blob>` | 包含 PNG 图片的单页 PDF。接受不含 `format` / `quality` 的图片选项。 |
| `downloadChartPDF(filename = 'chart.pdf', options?)` | `Promise<void>` | 下载 `toPDF()`。 |
| `copyChartImage(options?)` | `Promise<boolean>` | 将 PNG 复制到剪贴板。接受不含 `format` / `quality` 的图片选项。 |

## 图片选项

`toImage`、`toDataURL`、`downloadImage`、`toPDF` 和 `copyChartImage` 接受以下选项（`ChartImageOptions`）：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `format` | `'png' \| 'jpeg' \| 'webp'` | `'png'` | 图片格式。 |
| `quality` | `number` | 浏览器默认值 | JPEG / WebP 质量，0–1。 |
| `pixelRatio` | `number` | 当前画布像素比 | 每个 CSS 像素对应的输出像素数。按该尺寸重新渲染（每边最多 8192 px）。 |
| `background` | `'theme' \| 'transparent' \| string` | `'theme'` | 主题 surface 颜色、透明背景或任意 CSS 颜色。 |
| `overlay` | `boolean` | `true` | 合成 DOM 覆盖层（标题、图例、坐标轴）。`false` 时只导出画布。 |

### 捕获方式

- WebGPU 画布在帧呈现（present）后内容即被丢弃，因此每次导出都会重新渲染画布，并在同一任务内复制到 2D 画布。若读回结果完全透明，会在下一个动画帧重试，最多 2 次，仍失败则抛出 `toImage: canvas read back blank (GPU frame unavailable)`。
- `pixelRatio` 与当前像素比不同时，导出期间会临时调整画布 backing store 尺寸，结束后恢复。
- `background`：不透明的 CSS 颜色用作 GPU 清屏色。`'transparent'` 会分别在黑色和白色背景上渲染两次，以还原精确的 alpha。半透明 CSS 颜色铺在图表下方。JPEG 没有 alpha 通道，透明区域会变成黑色。
- DOM 覆盖层（标题、图例色块与名称及其隐藏状态、坐标轴刻度、坐标轴标题、标注标签）通过通用的 DOM 遍历，按布局后的位置及计算得到的字体、颜色、不透明度、删除线和旋转进行绘制。不想导出的覆盖层元素可加上 `data-charturbo-export="false"`。

## SVG 选项

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `maxMarks` | `number` | `200000` | 写出的图元（线段、填充三角形、柱子、点）上限。超出的点会被均匀抽稀，并在控制台输出警告。 |
| `background` | `'theme' \| 'transparent' \| string` | `'theme'` | 与图片选项相同。 |
| `overlay` | `boolean` | `true` | 包含 DOM 覆盖层文本（标题、图例、坐标轴）。 |

## 矢量 SVG

`exportChartSVG()` 以 CSS px 坐标写出引擎在最后一帧中暂存（staged）的 GPU 实例：

- 同一样式的连续线段合并为一个 `<path>` 折线；虚线使用 `stroke-dasharray` / `stroke-dashoffset`。
- 填充三角形按颜色合并为一个 `<path>`；柱子为数据端带圆角的 `<path>`（含间隙裁剪）。
- 标记和点为 `<circle>`（方形、菱形、三角形标记为 `<path>`）。
- 包含标注、刷选框和导航条，不包含悬停覆盖层。缩放时使用与画布相同的绘图区 `clipPath`。
- 覆盖层文本与图片导出采用相同的遍历方式，写为 `<text>`（计算得到的字体族、字号、字重、字形、颜色、旋转、省略号）和 `<rect>`（图例色块、标签底块）。
- 只写出抽稀（LOD）后的结果，因此 100 万点的折线图导出的 SVG 大小也只与屏幕像素列数相当。绘图区之外的点会被剔除。

| 图表 | SVG 输出 |
|---|---|
| line、area、bar（2D）、scatter、pie、box、candlestick、combo、radar、gauge、funnel、waterfall、treemap、sunburst、sankey | 矢量 |
| heatmap | 绘图区为 PNG `<image>`（单元格是 GPU 纹理）；坐标轴、图例和标签为矢量 |
| 3D / 2.5D 视图、没有 SVG 写出器的类型 | 整个画布作为 PNG `<image>`，其上叠加矢量文本，并输出控制台警告 |

## PDF

`toPDF()` 不依赖任何库，直接写出一个最小的单页 PDF。页面尺寸为图表的 CSS 尺寸（按 96 dpi 换算为 pt），图表标题写入文档标题。图片为合成后的 PNG 导出结果；浏览器支持 `CompressionStream('deflate')` 时压缩其 RGB 数据，否则不压缩。PDF 仅为位图：需要矢量输出时请使用 SVG。

## 剪贴板

`copyChartImage()` 通过 `ClipboardItem` 写入 PNG。浏览器没有 `ClipboardItem` / `navigator.clipboard.write`，或拒绝写入（权限、无用户手势）时返回 `false`。请在点击事件处理函数中调用。

## 限制

- 提示框位于覆盖层之外，不会被导出。
- 不绘制覆盖层内的 SVG、图片、边框和阴影；换成多行的文本会绘制为单行。
- 通过 `setPixelRatio` 设置的像素比，在高分辨率导出后会按画布重新计算。
- 导出的标签就是 DOM 中的内容，因此跟随图表的[区域设置](./i18n)。

## 另请参阅

- [无障碍](./accessibility)（CSV 导出）
- [动画](./animation)
- [样式与主题](./styling)
