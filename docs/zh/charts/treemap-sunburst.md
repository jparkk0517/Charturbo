# 矩形树图 · 旭日图

`renderTreemap` 将层级数据绘制为嵌套矩形（squarified 布局）；`renderSunburst` 将其绘制为圆环，每一层深度一个环。两者都展示树中部分与整体的占比，并支持点击下钻。叶子较多、需要精确比较面积时用矩形树图；层级结构更重要时用旭日图。

[在线示例](https://jparkk0517.github.io/Charturbo/hierarchy.html)

## 基本用法

```ts
import { Charturbo, type HierarchyNode } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

// 叶子带 `value`；父节点的值为子节点之和
const tree: HierarchyNode = {
  name: '营收',
  children: [
    { name: '美洲', children: [{ name: '硬件', value: 420 }, { name: '软件', value: 310 }] },
    { name: '欧洲', children: [{ name: '硬件', value: 260 }, { name: '服务', value: 180 }] },
  ],
};

sdk.renderTreemap(tree, { title: '营收', format: '$,.0f' });
// 或：sdk.renderSunburst(tree, { title: '营收', format: '$,.0f' });
sdk.on('drill', (e) => console.log(e.path.join(' › ')));
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderTreemap(data: HierarchyData, options?: TreemapChartOptions): { nodeCount: number }
renderSunburst(data: HierarchyData, options?: SunburstChartOptions): { nodeCount: number }
drillTo(target: number | string): boolean
drillUp(): boolean
```

## 数据格式

`HierarchyData` 可以是一个嵌套的根节点，也可以是扁平行数组。

```ts
type HierarchyData = HierarchyNode | HierarchyFlatNode[];

// 嵌套树
interface HierarchyNode {
  name: string;
  value?: number;              // 叶子值，有限且 >= 0（缺省 = 0；父节点上忽略）
  children?: HierarchyNode[];
  color?: ColorInput;          // 覆盖该节点的填充色
}

// 扁平行：`parent` 为另一行的 `id`（缺省 / null = 根）
interface HierarchyFlatNode {
  id: string | number;
  parent?: string | number | null;
  value?: number;
  name?: string;               // 显示名称（默认：id）
  color?: ColorInput;
}
```

```ts
sdk.renderSunburst([
  { id: 'src', name: 'src' },
  { id: 'sdk', parent: 'src', name: 'sdk' },
  { id: 'core', parent: 'sdk', name: 'charturbo.ts', value: 294 },
  { id: 'a11y', parent: 'sdk', name: 'chart-a11y.ts', value: 79 },
  { id: 'vue', parent: 'src', name: 'vue' },
  { id: 'vc', parent: 'vue', name: 'CharturboChart.ts', value: 3.7 },
], { title: '源码大小 (KB)', format: ',.1f' });
```

- 父节点的值始终为子节点之和；父节点上的 `value` 会被忽略。
- 叶子值必须有限且 `>= 0`（`NaN` 计为 0）。
- 扁平行有多个根时，会生成一个名为 `rootLabel`（默认 `'All'`）的虚拟根。
- 存在环时抛出异常，消息中列出环上的节点名称。
- 子节点按值从大到小排序。

## 选项

两种图表通用（`HierarchyChartOptions`）：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `colors` | `ColorInput[]` | 主题调色板 | 固定顺序的分类调色板。 |
| `colorBy` | `'auto' \| 'group' \| 'value'` | `'auto'` | `'group'`：按顶层分组使用调色板，超出调色板的分组折叠为中性色 "Other"。`'value'`：按深度归一化的数值色带。`'auto'`：顶层分组数不超过调色板时按分组，否则按数值。 |
| `colormap` | `'sequential' \| 'viridis' \| 'magma'` | `'sequential'` | `colorBy: 'value'` 使用的色带。 |
| `format` | `ChartValueFormat` | 本地化数字 | 标签、提示框、中心文字和无障碍文本的数值格式（`'$,.0f'` 这类格式字符串、`Intl` 选项或函数）。见[数字与日期格式](../guide/number-format)。 |
| `labels` | `boolean` | `true` | 在放得下的位置显示 DOM 标签。 |
| `maxDepth` | `number` | `0`（全部） | 当前根以下显示的层数。`0` = 全部。 |
| `legend` | `ChartLegendOptions \| boolean` | 分组着色模式下分组 ≥ 2 时显示 | 顶层分组。悬停突出显示分组，不支持切换。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 提示框和数据表中数值的名称。 |
| `rootLabel` | `string` | `'全部'`（随语言区域） | 多个根之上的虚拟根名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

仅矩形树图（`TreemapChartOptions`）：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `innerPadding` | `number` | `2` | 父节点在子节点周围的内边距（CSS px）。 |
| `headerHeight` | `number` | `20` | 父节点标题条高度（CSS px）。`0` = 无。 |

`SunburstChartOptions` 与 `HierarchyChartOptions` 相同。

## 下钻

两种图表都从顶层根开始，可以下钻到子树：

- **矩形树图**：点击单元格，下钻到当前根下包含该单元格的子分组。
- **旭日图**：点击圆弧下钻到该弧；点击中心返回上一层。
- 面包屑（位于标题和图例下方）和 Escape 键返回上一层。
- 键盘：Enter 下钻到当前聚焦的节点，Escape 返回上一层。

每次下钻都会触发 `'drill'` 事件：

```ts
interface CharturboDrillEvent {
  kind: 'treemap' | 'sunburst';
  node: number;            // 节点索引（树输入：深度优先顺序；虚拟根在最后）
  id?: string | number;    // 扁平输入的 id（树输入：undefined）
  name: string;
  path: string[];          // 从顶层根到 `node` 的名称
}

const off = sdk.on('drill', (e) => console.log(e.kind, e.path.join(' › ')));
```

在代码中使用 `drillTo` 和 `drillUp` 下钻。`drillTo` 接受节点索引、扁平输入的 `id` 或节点名称（第一个匹配）。两者在没有变化时（例如目标为叶子或已在顶层）返回 `false`。它们会触发 `'drill'` 事件，但不会渲染，之后需调用 `render()`。指针、键盘和面包屑下钻会自行渲染。

```ts
sdk.drillTo('美洲');
sdk.render();
sdk.drillUp();
sdk.render();
```

React 中使用 `onDrill`，Vue 中使用 `@drill`。见 [React](../guide/react) 和 [Vue](../guide/vue)。

## 交互

调用 `enableNodeInteractions(canvas)` 开启。

- 矩形树图悬停时为指针下的单元格绘制轮廓（标题条和内边距属于父节点）。
- 旭日图悬停时高亮路径（祖先和子树），其余圆弧向背景色淡化。中心显示当前根的值和名称，悬停时显示该节点及其占比。
- 不支持刷选、缩放和光标联动。
- 数据点 id 为节点索引（树输入：深度优先顺序；虚拟根在最后）。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'treemap' | 'sunburst'
// ctx.index = 节点索引
// ctx.hierarchy = { node, name, path, value, percentOfParent, percentOfTotal, depth, children }
// percentOfParent / percentOfTotal：0-100，根节点为 NaN；children：显示的子节点数（0 = 叶子）
```

## 说明

- 校验、环检测、汇总和排序在引擎（Rust）中以 O(n) 完成。
- 矩形树图：子节点平均面积小于 36 px² 的父节点（或位于 `maxDepth` 边界的父节点）整体绘制为一个单元格，因此绘制量取决于屏幕而非数据规模。单元格对齐设备像素，间隙精确为 2 px。
- 旭日图：短于 1 px 的圆弧连同其子树一起省略。
- 标签只放在放得下的单元格 / 圆弧上，从大到小（矩形树图最多 600 个，旭日图最多 300 个）；放不下的名称以省略号截断。
- 无障碍：摘要（节点数、合计、顶层分组占比）、数据表（每个节点的路径、值、占父节点 %、占整体 %），键盘导航：左右 = 兄弟节点，下 = 第一个子节点，上 = 父节点，Enter = 下钻，Escape = 返回。见[无障碍](../guide/accessibility)。

## 另请参阅

- [桑基图](./sankey)
- [饼图 · 环形图](./pie)
- [热力图](./heatmap)（色带）
- [提示框与悬停](../guide/tooltips)
