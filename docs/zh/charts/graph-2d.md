# 2D 关系图

`renderGraph` 在平面上绘制由节点和连线构成的网络，与 ECharts 的 `graph` 系列类似。节点可以由力导向布局放置，也可以排列在圆环上、放在给定位置，或放在直角坐标轴上。类别决定节点颜色并生成图例。适用于关系图、依赖图和小型社交网络。数千节点的 3D 网络（环绕相机）请见 [3D 网络图](./graph-3d)。

[在线示例](https://jparkk0517.github.io/Charturbo/graph.html#04-graph-force-2d)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGraph(
  {
    nodes: [
      { id: 'api', name: 'API', value: 12, category: 'Service' },
      { id: 'db', name: 'Database', value: 30, category: 'Storage' },
      { id: 'web', name: 'Web', value: 8, category: 'Service' },
    ],
    links: [
      { source: 'web', target: 'api' },
      { source: 'api', target: 'db', lineWidth: 3 },
    ],
  },
  { title: 'Services', layout: 'force', symbolSize: [10, 24], edgeSymbol: 'arrow' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderGraph(data: GraphChartData, options?: GraphChartOptions): { nodeCount: number; linkCount: number }
```

## 数据格式

```ts
interface GraphChartData {
  nodes: GraphNodeInput[];
  links?: GraphLinkInput[];
  edges?: GraphLinkInput[];             // links 的别名（ECharts）
  categories?: (GraphCategoryInput | string)[];
}

interface GraphNodeInput {
  id?: string | number;   // 连线键（默认：名称，其次是索引）
  name?: string;
  value?: number;         // 提示框、环形弧段大小、symbolSize [min, max]
  x?: number | string;    // layout 'none' / 'cartesian'（必填）；force：初始位置
  y?: number;
  category?: number | string; // categories 中的索引或类别名称
  symbolSize?: number;    // 直径，CSS px（优先于选项）
  fixed?: boolean;        // force：固定在 x / y
  color?: ColorInput;
}

interface GraphLinkInput {
  source: string | number; // 节点 id、名称或索引
  target: string | number;
  value?: number;
  lineWidth?: number;      // CSS px（默认：lineWidth 选项）
}

interface GraphCategoryInput { name: string; color?: ColorInput }
```

- 连线端点依次按 `id`、`name`、节点索引查找。
- 不在 `categories` 中的类别名称会追加到列表末尾。没有 `categories` 时，数字类别使用默认名称（`类别 1`、…，随语言变化）。
- 无效输入会在替换当前图表之前抛出错误，因此调用失败后原图表保持不变。错误信息会指出节点或连线：空节点列表、未知的连线端点、超出范围的类别、非有限数值、`layout: 'none'` / `'cartesian'` 下缺少 `x` / `y`、不属于坐标轴类目的 `x` 名称。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layout` | `'force' \| 'circular' \| 'none' \| 'cartesian'` | `'force'` | 节点放置方式（见布局）。 |
| `force` | `{ repulsion?, edgeLength?, gravity?, iterations? }` | `50, 30, 0.1, 300` | 力导向布局参数。 |
| `rotateLabel` | `boolean` | `false` | 环形：标签沿半径朝外。 |
| `symbol` | `'circle' \| 'rect' \| 'diamond' \| 'triangle'` | `'circle'` | 节点符号。 |
| `symbolSize` | `number \| [min, max]` | `10` | 直径（CSS px），或按 `value` 线性缩放。 |
| `lineWidth` | `number` | `1` | 边宽（CSS px）。 |
| `curveness` | `number` | `0` | 边的弯曲度（0 = 直线）。 |
| `edgeSymbol` | `'none' \| 'arrow'` | `'none'` | `'arrow'`：在目标端绘制箭头。 |
| `edgeSymbolSize` | `number` | `8` | 箭头长度（CSS px）。 |
| `edgeColor` | `'neutral' \| 'source' \| 'target'` | `'neutral'` | 边颜色：中性灰，或源 / 目标节点颜色。 |
| `edgeOpacity` | `number` | `1`（neutral），`0.6`（source / target） | 边的不透明度，0–1。 |
| `xAxis` | `{ min?, max?, title?, format?, categories? }` | | 直角坐标 x 轴。设置 `categories` 即为类目轴。 |
| `yAxis` | `{ min?, max?, title?, format? }` | | 直角坐标 y 轴。 |
| `legend` | `ChartLegendOptions \| boolean` | 有类别时显示 | 类别图例：点击隐藏类别，悬停强调类别。 |
| `colors` | `ColorInput[]` | 主题调色板 | 类别调色板。类别的 `color` 优先于对应槽位。 |
| `labels` | `boolean` | `true` | 节点名称（重叠的标签会被省略，最多 1,500 个）。 |
| `format` | `ChartValueFormat` | 本地化数字 | 提示框和无障碍中的数值文本；未设置 `yAxis.format` 时也用于直角坐标 y 轴刻度。 |
| `valueLabel` | `string` | `'数值'`（随语言变化） | 提示框和数据表中数值的名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

## 布局

- `force`：在 Rust 中于平面内运行 [3D 网络图](./graph-3d) 的 Barnes-Hut 力模拟直至稳定，然后适配到绘图区。初始布局是确定性的螺旋，因此相同数据得到相同图形。带 `fixed: true` 和 `x` / `y` 的节点保持原位。
- `circular`：按输入顺序将节点排列在圆环上。所有数值都 ≥ 0 且总和大于 0 时，每个节点按数值比例分得弧段（数值为 0 则不占弧段），否则等距排列。`rotateLabel` 让标签朝外旋转。
- `none`：使用给定的 `x` / `y`（与屏幕坐标一样 y 向下），适配到绘图区。
- `cartesian`：将给定的 `x` / `y` 放在带网格线的图表坐标轴上（y 向上）。设置 `xAxis.categories` 后 x 为类目轴：节点用类目名称或索引给出 `x`。

```ts
sdk.renderGraph(data, { layout: 'circular', rotateLabel: true, curveness: 0.3, edgeColor: 'source' });
sdk.renderGraph(data, { layout: 'cartesian', xAxis: { categories: ['Q1', 'Q2', 'Q3', 'Q4'] }, yAxis: { min: 0 } });
```

[环形示例](https://jparkk0517.github.io/Charturbo/graph.html#05-graph-circular) · [直角坐标示例](https://jparkk0517.github.io/Charturbo/graph.html#06-graph-cartesian)

## 交互

调用 `enableNodeInteractions(canvas)` 开启。悬停节点会高亮该节点、它的连线和邻居，并淡化其余部分。图例可隐藏或强调类别（代码中使用 `setSeriesVisible(k, visible)`）；连到隐藏节点的连线也会隐藏。框选、缩放和平移关闭。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'graph'
// ctx.hierarchy = { node, name, path: [category, name], value, children: <连接数> }
// ctx.details.metadata.attributes = { name, category, value, links }
```

React 与 Vue：`<CharturboChart type="graph" data={...} options={...} />`。

## 说明

- 无障碍：摘要（节点、类别和连线数量，连接最多的节点）、数据表（节点、类别、数值、连接、连接到）。键盘：上 / 下按输入顺序移动节点，右 / 左跳到下一个 / 上一个相连节点，Home / End。见[无障碍](../guide/accessibility)。
- CSV 和 SVG 导出包含关系图。
- 暂不支持：拖动节点（可用 `fixed` 固定）、自环、边悬停、力导向稳定过程的动画。

## 另请参阅

- [3D 网络图](./graph-3d)
- [树图](./tree)
- [桑基图](./sankey)
