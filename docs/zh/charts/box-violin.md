# 箱线图 · 小提琴图

箱线图按类别概括原始样本的分布：四分位数、须线、离群点以及可选的均值。设置 `violin` 后，每个组改为以核密度形状绘制。引擎以每组 O(n) 计算所有统计量，并且不保留原始样本。

[在线示例](https://jparkk0517.github.io/Charturbo/box.html)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderBoxPlot(
  {
    categories: ['周一', '周二', '周三'],
    series: [
      { name: '对照组', values: [monF32, tueF32, wedF32] }, // 每个类别的原始样本
      { name: '处理组', values: [a, b, c] },
    ],
  },
  {
    title: '响应时间',
    axes: { y: { title: 'ms' } },
    whiskers: 'tukey',
    showOutliers: true,
    showMean: true,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBoxPlot(
  data: BoxPlotData,
  options?: BoxPlotOptions
): { boxCount: number; seriesCount: number; categoryCount: number; sampleCount: number }
```

数据点 id：箱体 = `series * categories + category`；离群点的 id 排在箱体之后。

## 数据格式 {#data-format}

`BoxPlotData`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `categories` | `string[]` | 类别（x 轴）标签。 |
| `series[].name` | `string` | 系列名称。 |
| `series[].values` | `(Float32Array \| number[] \| null \| undefined)[]` | 每个类别一个原始样本数组。为空或缺失 = 不绘制箱体。 |
| `series[].color` | `ColorInput` | 默认：按系列顺序使用主题调色板。 |

多个系列在每个类别中并排排列，与分组柱状图相同。

## 选项 {#options}

`BoxPlotOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `whiskers` | `'tukey' \| 'minmax' \| [number, number]` | `'tukey'` | `'tukey'`：距四分位数 `iqrFactor` × IQR 范围内的最后一个样本。`'minmax'`：数据极值（无离群点）。`[p0, p1]`：0–100 的百分位数，例如 `[5, 95]`。 |
| `iqrFactor` | `number` | `1.5` | Tukey IQR 系数。 |
| `showOutliers` | `boolean` | `true` | 以点的形式显示离群点（箱线模式）。 |
| `maxOutliers` | `number` | `10000` | 每组绘制的离群点数量上限。超出部分均匀抽样；计数保持精确。 |
| `showMean` | `boolean` | `false` | 以空心圆点显示均值。 |
| `outline` | `boolean` | `false` | 箱体只绘制轮廓，而不是填充的柱子。 |
| `violin` | `boolean \| BoxPlotViolinOptions` | `false` | 以小提琴（KDE）代替箱体。 |
| `colors` | `ColorInput[]` | 主题调色板 | 系列颜色。 |
| `title` | `string` | — | 图表标题。 |
| `description` | `string` | — | canvas 的无障碍名称。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 值在提示框和数据表中的名称。 |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | 坐标轴标题和格式。 |
| `legend` | `ChartLegendOptions \| boolean` | 2 个及以上系列时显示 | 支持切换和强调的系列图例。 |
| `groupGap` | `number` | `0.3` | 每个类别槽位中组与组之间空白所占的比例。 |
| `boxGap` | `number` | `2` | 同组箱体之间的间距，单位为 CSS px。 |
| `cornerRadius` | `number` | `4` | 箱体端部圆角，单位为 CSS px。 |
| `whiskerWidth` | `number` | `1.5` | 须线 / 轮廓的描边宽度，单位为 CSS px。 |
| `outlierRadius` | `number` | `3` | 离群点的半径，单位为 CSS px。 |
| `hover` | `ChartHoverStyle` | — | 悬停样式。 |
| `showBackdropGrid` | `boolean` | `true` | 水平网格线和基线。 |
| `grid` | `ChartGridStyle` | — | 网格样式。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距，单位为 CSS px。 |
| `animation` | `ChartAnimationInput` | SDK 设置 | 进入 / 更新动画。 |
| `width` | `number` | `164` | 绘图区的世界坐标宽度。 |
| `height` | `number` | `80` | 绘图区的世界坐标高度。 |

## 小提琴图 {#violin}

```ts
sdk.renderBoxPlot(data, { violin: { showBox: true, scale: 'area', opacity: 0.3 } });
```

`BoxPlotViolinOptions`：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `bandwidth` | `number` | 每组按 Silverman 规则计算 | 高斯核带宽，使用数据单位。 |
| `showBox` | `boolean` | `true` | 内部箱体（须线、IQR 柱、中位数圆点）。`false` = 只显示中位数线。 |
| `scale` | `'area' \| 'width'` | `'area'` | `'area'`：每个小提琴围成的面积相同。`'width'`：每个小提琴都达到完整宽度。 |
| `opacity` | `number` | `0.3` | 小提琴主体的填充不透明度。 |

KDE 先通过线性分箱映射到细网格，再在 128 个点上求值：复杂度为 O(n + grid)，而不是 O(n · grid)，即使有 1,000,000 个样本也是如此。小提琴图不绘制离群点。

## 统计量 {#statistics}

- 四分位数使用选择算法（`select_nth_unstable`）而非排序计算，结果与 numpy 的线性插值一致。
- 再遍历一次，计算须线端点、离群点数量和标准差。
- 超出 `maxOutliers` 的离群点按均匀、确定性的步长抽样；最小值和最大值始终保留。

## 悬停与图例 {#hover-and-legend}

- 悬停在箱体上会显示最小值、Q1、中位数、Q3、最大值、均值、须线、n 和离群点数量。悬停在离群点上会显示其值。`ctx.box` 保存这些统计量。
- 图例（2 个及以上系列）可切换和强调系列。超过 8 个系列时折叠进 "Other"。
- 箱线图不支持刷选和缩放。

见[提示框与悬停](../guide/tooltips)。

## 无障碍 {#accessibility}

图表提供摘要、数据表和 CSV（每个类别 × 系列一行），以及键盘导航（左 / 右 = 类别，上 / 下 = 系列）。见[无障碍](../guide/accessibility)。

## 更新数据 {#updating-data}

用新的样本再次调用 `renderBoxPlot`。

## 框架 {#frameworks}

```tsx
<CharturboChart type="box" data={{ categories, series }} options={{ violin: true }} />
```

## 另请参阅 {#see-also}

- [直方图](./histogram)
- [柱状图](./bar)
