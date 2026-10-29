# 和弦图

`renderChordChart` 以圆形绘制组之间的流量。每个组有一段外弧，弧长与其总流量成正比；连接两组的弦两端宽度分别是两个方向的流量。布局与 d3 `chord()`（`directed` 时为 `chordDirected()`）一致。适合人口迁移、贸易、团队间转移等方形"来源 → 目标"矩阵。

[在线示例](https://jparkk0517.github.io/Charturbo/hierarchy.html#07-chord)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderChordChart(
  {
    names: ['Black', 'Blond', 'Brown', 'Red'],
    matrix: [
      [11975, 5871, 8916, 2868],
      [1951, 10048, 2060, 6171],
      [8010, 16145, 8090, 8045],
      [1013, 990, 940, 6907],
    ],
  },
  { title: 'Hair color preferences', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderChordChart(data: ChordChartData, options?: ChordChartOptions): { groupCount: number; chordCount: number }
```

## 数据格式

```ts
type ChordChartData =
  | { matrix: ArrayLike<ArrayLike<number>>; names?: string[] }
  | { nodes: (string | ChordNode)[]; links: ChordLink[] };

interface ChordNode { name: string; color?: ColorInput }
interface ChordLink { source: string | number; target: string | number; value: number }
```

- `matrix[i][j]` 是从组 `i` 到组 `j` 的流量。矩阵必须是方阵，包含 1 到 256 个组。数值必须有限且 `>= 0`，并且至少有一个大于 0。对角线（流向自身）绘制为自环弦。
- `names` 为每一行提供一个名称。未提供时名称为 `组 1`、`组 2`……（按图表语言）。
- ECharts 风格的 `nodes` / `links`：链接用节点名称或索引指定来源和目标，重复的链接会累加。未知节点或重复节点会抛出异常。
- 输入在替换当前图表之前校验。抛出异常时，原图表保持不变。

## 有向和弦

默认（d3 `chord()`）每对组共用一条弦，两端宽度为两个方向的流量，较大的方向作为来源。`directed: true` 改用 d3 `chordDirected()`：每个方向各一条弦，并在目标端绘制箭头。

```ts
sdk.renderChordChart(
  {
    nodes: ['Asia', 'Europe', 'Africa'],
    links: [
      { source: 'Asia', target: 'Europe', value: 14 },
      { source: 'Europe', target: 'Asia', value: 4 },
      { source: 'Africa', target: 'Europe', value: 9 },
    ],
  },
  { directed: true, ribbonColor: 'gradient', labelRotate: true }
);
```

[在线示例](https://jparkk0517.github.io/Charturbo/hierarchy.html#08-chord-directed)

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `padAngle` | `number` | `3` | 组之间的间隔（度）。`n * padAngle` 必须小于 360。 |
| `startAngle` | `number` | `0` | 第一个组的起始角度，从 12 点方向顺时针计算（度）。 |
| `clockwise` | `boolean` | `true` | 组按顺时针排列。 |
| `sortGroups` | `'none' \| 'ascending' \| 'descending'` | `'none'` | 按总量排列组。 |
| `sortSubgroups` | `ChordSortOrder` | `'none'` | 每个组弧上弦的顺序（按数值）。 |
| `sortChords` | `ChordSortOrder` | `'none'` | 弦的绘制顺序（按两端数值之和）。 |
| `directed` | `boolean` | `false` | 每个方向一条弦，带箭头。 |
| `ribbonColor` | `'source' \| 'target' \| 'gradient' \| 'neutral'` | `'source'` | 弦的颜色：来源组、目标组、来源到目标的渐变，或主题中性色。 |
| `ribbonOpacity` | `number` | `0.6` | 弦的不透明度，0 到 1。 |
| `arcWidth` | `number` | `14` | 组弧宽度（CSS px）。 |
| `labels` | `boolean` | `true` | 在圆环外显示组名称。 |
| `labelRotate` | `boolean` | `false` | 名称沿半径方向排列，而不是水平排列。 |
| `colors` | `(ColorInput \| undefined)[]` | | 每个组的颜色。未提供时使用节点 `color`，再使用调色板。 |
| `palette` | `ColorInput[]` | 主题调色板 | 没有自身颜色的组所用的颜色。 |
| `legend` | `boolean \| ChartLegendOptions` | 2 个及以上组时显示 | 组图例。悬停高亮组，点击隐藏组。 |
| `valueLabel` | `string` | `'Value'`（本地化） | 提示框和数据表中数值的名称。 |
| `format` | `ChartValueFormat` | 本地数字格式 | 提示框和无障碍的数值文本。见[数字与日期格式](../guide/number-format)。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

无效选项会抛出异常：负数或过大的 `padAngle`、非有限的 `startAngle`、超出 0 到 1 的 `ribbonOpacity`、小于 1 的 `arcWidth`，以及未知的排序值或 `ribbonColor`。

## 交互

调用 `enableNodeInteractions(canvas)` 开启。

- 悬停组弧会高亮该组的弦、淡化其他弦，并显示组的总量。
- 悬停弦会显示 `来源 → 目标` 的流量，如有反向流量也一并显示。
- 悬停图例会高亮对应组。点击图例会隐藏该组并重新布局；开启 `animation` 时，弧和弦会过渡到新布局。
- 刷选、缩放和平移均关闭。

数据点 id：组 `i` 为 `i`，从 `s` 到 `t` 的弦为 `n + s * n + t`。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'chord'
// ctx.chord = { kind: 'group' | 'ribbon', source, target, sourceName, targetName, value, reverse? }
// 组：source === target，value = 总量；弦：value = 来源 → 目标，reverse = 目标 → 来源
```

## 说明

- 布局、弧、弦、箭头、命中测试、高亮和标签位置均在引擎（Rust）中计算。弧和弦是矢量图元，`exportChartSVG` 会将其写为 SVG 路径。
- 无障碍：摘要（组数、弦数、最大流量）。数据表和 `exportChartCSV` 为流量矩阵（行 = 来源，列 = 目标）。键盘：左 / 右在组之间或弦之间移动，下从组进入其第一条弦，上从弦回到来源组，Home / End 跳到第一项 / 最后一项，Esc 清除。见[无障碍](../guide/accessibility)。
- 标签宽度为估算值（11px 文字每字符约 6.8px），过长的名称会以 `…` 截断。
- React / Vue：`type="chord"`。

## 另请参阅

- [桑基图](./sankey)
- [树图](./tree)
- [提示框与悬停](../guide/tooltips)
