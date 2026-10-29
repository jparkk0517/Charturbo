# 树图

`renderTree` 将层级数据绘制为节点-连线图：采用 d3 `tree()` 的 tidy tree 布局，可以是正交布局（从左到右、从右到左、从上到下、从下到上）或径向布局。点击或用键盘展开、折叠父节点，树会带过渡动画重新布局。适合组织架构、文件树、分类体系、决策树等结构比数值更重要的数据。

[在线示例](https://jparkk0517.github.io/Charturbo/hierarchy.html#05-tree)

## 基本用法

```ts
import { Charturbo, type TreeChartNode } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { animation: { duration: 450 } });

const tree: TreeChartNode = {
  name: 'charturbo',
  children: [
    { name: 'core', children: [{ name: 'chart' }, { name: 'scene' }, { name: 'graph' }] },
    { name: 'sdk', children: [{ name: 'charturbo.ts' }, { name: 'messages', collapsed: true, children: [{ name: 'en' }, { name: 'ko' }] }] },
    { name: 'react' },
  ],
};
sdk.renderTree(tree, { title: 'Package layout', initialTreeDepth: 2 });
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderTree(data: TreeChartData, options?: TreeChartOptions): { nodeCount: number }
setTreeNodeExpanded(target: number | string, expanded: boolean): boolean
toggleTreeNode(target: number | string): boolean
```

## 数据格式

输入形式与[矩形树图 · 旭日图](./treemap-sunburst)相同：一个嵌套的根节点，或扁平行数组。

```ts
type TreeChartData = TreeChartNode | TreeChartFlatNode[];

interface TreeChartNode {
  name: string;
  value?: number;            // 可选，原样显示（父节点不累加子节点）
  children?: TreeChartNode[];
  color?: ColorInput;
  collapsed?: boolean;       // 初始折叠（false：初始展开）；优先于 initialTreeDepth
}

interface TreeChartFlatNode {
  id: string | number;
  parent?: string | number | null; // 另一行的 id（缺省 / null = 根）
  name?: string;                   // 显示名称（默认：id）
  value?: number;
  color?: ColorInput;
  collapsed?: boolean;
}
```

- 子节点保持输入顺序（不按数值排序）。
- 有多个根的扁平行会挂在名为 `rootLabel`（默认 `'全部'`，随语言变化）的合成根节点下。
- 存在环时抛出错误，错误信息列出环上的节点。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `layout` | `'orthogonal' \| 'radial'` | `'orthogonal'` | `'radial'`：根节点在中心，叶节点在外圈。 |
| `orient` | `'LR' \| 'RL' \| 'TB' \| 'BT'` | `'LR'` | 正交布局中从根到叶的方向。 |
| `edgeShape` | `'curve' \| 'polyline'` | `'curve'` | 三次贝塞尔曲线或折线连线。径向布局始终为曲线。 |
| `initialTreeDepth` | `number` | `2` | 初始展开的层数（根 = 0，`-1` = 全部）。节点的 `collapsed` 优先。 |
| `expandAndCollapse` | `boolean` | `true` | 点击、Enter、空格展开和折叠父节点。 |
| `symbol` | `'emptyCircle' \| 'circle' \| 'rect' \| 'diamond' \| 'triangle' \| 'none'` | `'emptyCircle'` | 节点标记。`'emptyCircle'` 时折叠的父节点为实心。 |
| `symbolSize` | `number` | `7` | 标记直径（CSS px）。 |
| `lineWidth` | `number` | `1.5` | 连线宽度（CSS px）。 |
| `curvature` | `number` | `0.5` | 贝塞尔控制点偏移，0–1。 |
| `colorBy` | `'single' \| 'group'` | `'single'` | `'group'`：每个顶层分支一种调色板颜色。 |
| `colors` | `ColorInput[]` | 主题调色板 | `colorBy: 'group'` 的调色板。 |
| `labels` | `boolean` | `true` | 节点名称。 |
| `format` | `ChartValueFormat` | 区域设置数字 | 提示框和无障碍中的数值文本。 |
| `valueLabel` | `string` | `'数值'`（随语言变化） | 提示框和数据表中数值的名称。 |
| `rootLabel` | `string` | `'全部'`（随语言变化） | 多根扁平行的合成根节点名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

## 布局

- 引擎（Rust）以 O(n) 运行 Walker / Buchheim tidy tree，遵循 d3 的间隔规则：兄弟节点 1，堂兄弟节点 2，径向布局中再除以深度。
- 只有展开的节点参与布局，折叠一个分支后其余部分会更紧凑。
- 树会适配绘图区，并在外侧为根节点和叶节点标签留出空间（径向半径减去最长叶节点标签的宽度）。
- 标签：正交布局中叶节点的名称位于远离根的一侧，父节点位于朝向根的一侧；TB / BT 的叶节点标签竖排。径向标签向外旋转，左半边翻转以保持文字正向。与相邻标签重叠的标签会被省略。

```ts
sdk.renderTree(rows, { layout: 'radial', colorBy: 'group', initialTreeDepth: -1 });
sdk.renderTree(tree, { orient: 'TB', edgeShape: 'polyline', symbol: 'rect' });
```

[在线示例](https://jparkk0517.github.io/Charturbo/hierarchy.html#06-tree-radial)

## 展开与折叠

- 点击父节点切换其状态（叶节点无反应）。开启 `animation` 时，节点和连线从旧布局过渡到新布局，折叠的分支收拢到父节点。
- `setTreeNodeExpanded(target, expanded)` 和 `toggleTreeNode(target)` 接受节点索引、扁平行 `id` 或节点名称。没有变化时（叶节点、隐藏节点、非树图）返回 `false`。调用后请执行 `render()`；指针和键盘切换会自行渲染。
- 每次切换都会触发 `'treeToggle'`：

```ts
sdk.on('treeToggle', (e) => console.log(e.name, e.expanded, e.path));
// e: { node: number; id?: string | number; name: string; path: string[]; expanded: boolean }
```

React 与 Vue：`<CharturboChart type="tree" data={...} options={...} onTreeToggle={...} />`（Vue：`@tree-toggle`）。

## 交互

调用 `enableNodeInteractions(canvas)` 开启。悬停时高亮节点并显示其路径、名称和数值。框选、缩放和光标同步均关闭；不支持平移和缩放。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'tree'
// ctx.xLabel = 'Root › A › a1'
// ctx.hierarchy = { node, name, path, value, depth, ... }   // 无数值时 value 为 NaN
```

## 说明

- 无障碍：摘要（节点数和层数、显示的节点、根节点的子节点）、数据表（路径、数值、深度、状态）。键盘：上 / 下在兄弟节点间移动，右进入已展开节点的第一个子节点，左回到父节点，Home / End，Enter 或空格展开 / 折叠。见[无障碍](../guide/accessibility)。
- CSV 和 SVG 导出包含树图。标签宽度为估算值（11px 文字每字符约 6.8px），过长的名称会以 `…` 截断。

## 另请参阅

- [矩形树图 · 旭日图](./treemap-sunburst)
- [桑基图](./sankey)
- [提示框与悬停](../guide/tooltips)
