# 桑基图

`renderSankey` 将节点之间的流量绘制为宽度与数值成正比的条带，节点按列排列。适合预算、能源平衡、用户路径等有方向、无环的流向数据。

[在线示例](https://jparkk0517.github.io/Charturbo/hierarchy.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const link = (source: string, target: string, value: number) => ({ source, target, value });
sdk.renderSankey(
  {
    nodes: ['煤炭', '天然气', '太阳能', '电力', '热力', '居民', '工业'].map((id) => ({ id })),
    links: [
      link('煤炭', '电力', 30), link('煤炭', '热力', 12),
      link('天然气', '电力', 22), link('天然气', '热力', 18),
      link('太阳能', '电力', 14),
      link('电力', '居民', 36), link('电力', '工业', 30),
      link('热力', '居民', 18), link('热力', '工业', 12),
    ],
  },
  { title: '能源 (TWh)', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderSankey(data: SankeyChartData, options?: SankeyChartOptions): { nodeCount: number; linkCount: number }
```

## 数据格式

```ts
interface SankeyChartData {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
}

interface SankeyNodeInput {
  id: string | number;
  name?: string;        // 显示名称（默认：id）
  color?: ColorInput;
  group?: string;       // 颜色分组（按首次出现顺序分配调色板；图例列出各分组）
  column?: number;      // 最小列（0 = 最左）
}

interface SankeyLinkInput {
  source: string | number; // 节点 id
  target: string | number; // 节点 id
  value: number;           // 有限且 >= 0
}
```

- 节点的值为流入与流出中的较大者。
- `column` 是最小值：节点总是位于其所有来源节点的右侧，且只保留实际使用的列。
- 以下输入会抛出异常：
  - 重复的节点 id，或指向未知 id 的链接（`Sankey link 3 has an unknown source "X"`）；
  - 负值或非有限的链接值；
  - 指向自身的链接，或构成环的链接（`Sankey links form a cycle: "A" -> "B" -> "A"`）；
  - 两端节点都显式指定了 `column`，但链接指向同一列或更靠前的列。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `nodeWidth` | `number` | `12` | 节点条宽度（CSS px；纵向时为节点条高度）。 |
| `nodePadding` | `number` | `10` | 同一列节点之间的间距（CSS px）。 |
| `orient` | `'horizontal' \| 'vertical'` | `'horizontal'` | 流向：从左到右的列，或从上到下的行。见[纵向布局](#vertical-layout)。 |
| `iterations` | `number` | `32` | 布局松弛迭代次数。 |
| `align` | `'justify' \| 'left' \| 'right' \| 'center'` | `'justify'` | 未指定 `column` 的节点的列分配方式。`'justify'` 将汇点放在最后一列。 |
| `linkColor` | `'source' \| 'target' \| 'neutral' \| 'gradient'` | `'source'` | 条带颜色。`'gradient'` 从来源颜色过渡到目标颜色。 |
| `linkOpacity` | `number` | `0.5` | 条带不透明度。 |
| `colors` | `ColorInput[]` | 主题调色板 | 固定顺序的分类调色板。 |
| `levels` | `SankeyLevelOptions[]` | — | 按列设置节点颜色和链接不透明度。见[颜色与标签](#colors-and-labels)。 |
| `labels` | `boolean` | `true` | 节点条旁的标签。 |
| `format` | `ChartValueFormat` | 本地化数字 | 标签、提示框和无障碍文本的数值格式。见[数字与日期格式](../guide/number-format)。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 提示框和数据表中数值的名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `legend` | `ChartLegendOptions \| boolean` | 分组 ≥ 2 时显示 | 列出节点分组。静态图例，不支持切换或突出显示。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

## 布局

布局遵循 d3-sankey 方法，在引擎（Rust）中计算：

1. 列：以从来源节点出发的最长路径为基础，再按 `align` 或显式 `column` 调整。
2. 节点高度与其值成正比，缩放比例使最拥挤的一列能够放下。
3. 进行 `iterations` 轮松弛：把节点移向相邻节点的加权位置（先从右到左，再从左到右），随后逐列消解碰撞。最后一轮之后，同一列的节点不会重叠。

链接是两端水平切线的三次贝塞尔条带，半透明绘制，从粗到细依次绘制，细的流量显示在上层。

## 纵向布局 {#vertical-layout}

```ts
sdk.renderSankey(data, {
  title: '能源 (TWh)',
  orient: 'vertical',
  linkColor: 'gradient',
  levels: [
    { column: 0, linkOpacity: 0.65 },
    { column: 2, color: '#64748b' },
  ],
});
```

- `orient: 'vertical'` 在流向坐标（沿流向和横跨流向）中计算相同的布局，然后在屏幕上交换 x 和 y。列变为从上到下排列的行。
- 命中测试、键盘位置和导出的节点矩形使用相同的变换。
- 标签以节点条为中心：上半部分节点的标签在节点条下方，其余在上方。同一行中，标签中心之间的距离小于最长标签宽度（由 SDK 估算）时会省略标签，保留较大节点的标签。

[在线示例](https://jparkk0517.github.io/Charturbo/hierarchy.html#04-sankey-vertical)

## 颜色与标签 {#colors-and-labels}

- 节点颜色：有 `group` 时按分组；否则节点数不超过调色板时按节点；再否则按列（超出调色板的节点为灰色）。
- 标签显示名称和数值：左半部分节点的标签在右侧，其余在左侧。同一列中两个标签距离小于一行时，保留较大节点的标签。
- `linkColor: 'gradient'`：每条条带的颜色沿条带从来源节点颜色线性过渡到目标节点颜色。
- `levels`（与 ECharts `levels` 相同）设置某一列的样式：节点颜色（节点自身的 `color` 优先）以及从该列流出的链接的不透明度。多个条目指定同一列时，以最后一个为准。

| `levels[]` 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `column` | `number` | — | 列索引（0 = 来源节点），按移除未使用的列之后的编号计算。 |
| `color` | `ColorInput` | 上述节点颜色规则 | 该列节点的颜色。 |
| `linkOpacity` | `number` | 图表的 `linkOpacity` | 从该列流出的链接的不透明度，0–1。 |

## 交互

调用 `enableNodeInteractions(canvas)` 开启。悬停时先查找节点，再从上到下查找条带。只高亮与悬停节点或链接相连的流量。不支持下钻。不支持刷选、缩放和光标联动。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'sankey'
// ctx.flow = { kind: 'link', source, target, value, percentOfSource }
//          | { kind: 'node', source, value, inflow, outflow }   // 节点：名称在 `source` 中
```

数据点 id：节点为节点索引，链接为节点数 + 链接索引。

## 说明

- 每轮松弛的开销为 O(N + L log L)，即使有枢纽节点也不会变慢。
- 无障碍：摘要（节点数、列数、链接数、最大流量）、数据表（每条链接的来源、目标、值、占来源 %），左右方向键在链接之间移动。见[无障碍](../guide/accessibility)。

## 另请参阅

- [矩形树图 · 旭日图](./treemap-sunburst)
- [漏斗图](./funnel)
- [提示框与悬停](../guide/tooltips)
- [样式与主题](../guide/styling)
