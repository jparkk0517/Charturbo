# 交互

`enableNodeInteractions(canvas, options)` 将鼠标、滚轮、触摸、笔和键盘输入绑定到图表：提示框、缩放与平移、可撤销的框选缩放、刷选以及 SDK 事件。本页介绍 2D 图表的导航与选择；提示框另有专页说明。

[在线示例](https://jparkk0517.github.io/Charturbo/scatter.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { title: '吞吐量' });
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

// 之后：移除监听器和提示框（dispose() 也会执行此操作）
detach();
```

`autoRender`（默认 `false`）会在悬停、点击和导航变化后调用 `sdk.render()`。关闭时需自行调用 `render()`。React 和 Vue 组件中默认为 `true`。

## 鼠标操作

| 输入 | 折线图 / 面积图 / K 线图 | 散点图 |
|---|---|---|
| 滚轮 | 以指针为中心缩放 x | 缩放 x 和 y |
| Shift + 滚轮 | 缩放 y（固定折线图 y 值域） | 缩放 y |
| 拖动 | 平移 x | 平移 x 和 y |
| Ctrl / ⌘ + 拖动 | 框选缩放（x + y） | 框选缩放 |
| 双击 | 重置缩放 | 重置缩放 |
| Ctrl / ⌘ + Z | 撤销缩放（画布获得焦点时） | 撤销缩放 |
| Ctrl / ⌘ + Shift + Z、Ctrl + Y | 重做缩放 | 重做缩放 |

热力图可在两个轴上缩放和平移。柱状图没有滚轮 / 拖动导航。组合图仅支持 x 滚轮缩放、平移和缩放历史（不支持框选缩放和 y 缩放）。网络图和 3D 视图使用各自的相机控制（见[3D 网络图](../charts/graph-3d)）。

## 交互选项

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `autoRender` | `boolean` | `false` | 悬停 / 点击 / 导航变化时自动渲染 |
| `chartNavigation` | `boolean` | `true` | 2D 图表的滚轮缩放、拖动平移和双击重置 |
| `zoom` | `'x' \| 'y' \| 'xy'` | `'x'` | 滚轮缩放的坐标轴；Shift + 滚轮始终缩放 y |
| `zoomMode` | `'pan' \| 'box'` | `'pan'` | `'pan'`：拖动平移，Ctrl / ⌘ + 拖动框选缩放。`'box'`：拖动框选缩放，Alt + 拖动平移 |
| `brush` | `'x' \| 'xy' \| false` | 不变（关闭） | 拖动刷选，见[刷选](#brush-selection) |
| `brushStyle` | `BrushStyleOptions` | — | 刷选矩形的外观 |
| `touch` | `false \| TouchInteractionOptions` | 全部开启 | 触摸与笔手势 |
| `cameraControls` | `false \| CameraControlOptions` | 全部开启 | 网络图 / 3D 视图的相机控制 |
| `builtInTooltip`、`tooltip`、`formatChartTooltip`、… | | | 见[提示框与悬停](./tooltips) |
| `onNodeHover` | `(details, pointer) => void` | — | 悬停的数据点 / 节点变化 |
| `onNodeClick` | `(details, event) => void` | — | 点击；点击空白处时为 `null` |

## 以代码缩放和平移

```ts
sdk.setXRange(Date.parse('2026-01-01'), Date.parse('2026-02-01')); // 数据单位；时间轴可传 Date
sdk.getXRange();          // [min, max] | null
sdk.setYRange(55, 95);    // 散点图：缩放 y；折线图 / 面积图：固定 y 值域
sdk.getYRange();          // [min, max] | null
sdk.zoomChartX(0.5);      // factor < 1 为放大，围绕 NDC 锚点 x（默认 0）
sdk.zoomChartXY(0.5, 0, 0); // 散点图：两个轴
sdk.panChartX(0.1);       // NDC 位移
sdk.resetChartZoom();
sdk.render();
```

- 范围使用数据单位：折线图为系列 `x`（时间轴为 epoch ms）或样本索引；散点图为 x / y 值。
- `setXRange` 和 `setYRange` 与滚轮一样将范围限制在数据和缩放极限内，视图发生变化时返回 `true`。
- 这些调用不会记录缩放历史。如需可撤销，请先调用 `pushZoomHistory()`。

## Y 轴缩放与框选缩放 {#y-zoom-and-box-zoom}

```ts
sdk.enableNodeInteractions(canvas, {
  zoom: 'x',       // 滚轮轴：'x'（默认）| 'y' | 'xy'
  zoomMode: 'pan', // 'pan'（默认）| 'box'
});
sdk.zoomChartY(0.5, 0);                 // 围绕 NDC 锚点 y 缩放 y
sdk.zoomChartBox(-0.4, 0.5, 0.3, -0.3); // 按 NDC 矩形缩放 x + y
```

- 在折线图和面积图上，手动 y 缩放会以数据单位**固定** y 窗口：autoscale、数据更新和数据流不再改变 y。`resetChartZoom()`（双击）解除固定并恢复 autoscale。双 y 轴图表的两个 y 轴按同一屏幕区间一起缩放。散点图只缩放其 y 窗口。
- 框选缩放在拖动时绘制虚线矩形，松开后将 x 和 y 缩放到该矩形（限制在绘图区内）。小于 4 px 的框视为点击。Escape 取消进行中的框选。框选缩放会清除已有的刷选。
- 框选缩放适用于折线图、面积图、散点图和 K 线图。

## 缩放历史

```ts
sdk.undoZoom();      // 视图变化时返回 true
sdk.redoZoom();
sdk.zoomHistory;     // { undo, redo, max: 50 }
sdk.pushZoomHistory();
sdk.clearZoomHistory();
```

- 每个鼠标手势在开始前记录一步：一次连续滚轮（400 ms 内的事件）、一次拖动平移或一次框选缩放。触摸手势不记录。新手势会清除重做步骤。
- 最多保留 50 步。双击重置会清空历史，新图表从空历史开始。
- 程序调用（`setXRange` 等）不会被记录。

## 刷选 {#brush-selection}

```ts
sdk.enableNodeInteractions(canvas, {
  brush: 'x', // 'x' = x 区间（时间范围），'xy' = 矩形，false = 关闭
  brushStyle: { color: '#3b82f6', fillOpacity: 0.15, borderWidth: 1 },
});
sdk.on('select', (sel) => {
  if (!sel.xRange) return clearDetail(); // 已清除（Escape、点击、clearChartSelection）
  if (sel.kind === 'line') sel.ranges.forEach(({ series, start, end }) => { /* [start, end) 样本 */ });
  else console.log(sel.ids, sel.count);  // 散点图：点 id，柱状图：类目索引，K 线图：K 线索引
});

sdk.setChartBrush('xy');           // 运行时切换；用 getChartBrush() 读取
sdk.selectChartRange([new Date('2026-02-01'), new Date('2026-03-01')]); // 触发 'select'
sdk.selectChartRange([1, 2], [-3, 4]);                                  // 同时指定 y 范围
sdk.getSelection();                // 已确认的选择或 null
sdk.clearChartSelection();         // 若存在选择则触发空的 'select'
```

- 启用刷选时：拖动绘制刷选框（移动不足 5 px 视为点击），松开后确认并触发 `'select'`；**Alt + 拖动**为平移，滚轮缩放和双击重置照常工作。点击、Escape（画布获得焦点时）或 `clearChartSelection()` 会清除选择。
- 柱状图始终按 x 区间刷选。面积图报告 `kind: 'line'`。
- 刷选适用于具有数据坐标系的 2D 图表。热力图、箱线图、饼图、组合图、商业图表和层级图表没有刷选，其 `'select'` 负载为空。横向柱状图、3D 柱状图和 2.5D 折线视图也没有刷选。
- 数据或图例变化后，`getSelection()` 返回重新查询的结果。渲染新图表时，若仍有选择会触发空的 `'select'`。

`CharturboSelection`（`'select'` 负载）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `kind` | `'line' \| 'bar' \| 'scatter' \| 'candlestick' \| …` | 图表类型 |
| `mode` | `'x' \| 'xy'` | 刷选形状 |
| `xRange` | `[number, number] \| null` | 数据单位的 x 范围；`null` = 已清除 |
| `yRange` | `[number, number] \| null` | y 范围（`'xy'` 模式），否则为 `null` |
| `ranges` | `{ series, start, end }[]` | 折线图 / 面积图：每个可见系列被选中的样本区间 |
| `ids` | `Uint32Array` | 散点 id、柱状图类目索引或 K 线索引（升序，仅可见系列） |
| `count` | `number` | 被选中的样本 / 点 / 类目数 |

`BrushStyleOptions`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `color` | `ColorInput` | 引擎蓝灰色 | 边框颜色；填充为同一颜色乘以 `fillOpacity` |
| `fillOpacity` | `number` | `0.15` | 填充透明度系数 |
| `borderWidth` | `number` | `1` | 边框宽度，CSS px（`0` = 无） |

## 触摸与笔 {#touch-and-pen}

`enableNodeInteractions` 通过 Pointer Events 读取触摸和笔输入（鼠标行为不变）。绑定期间会在画布上设置 `touch-action: none`，解绑时恢复原值。

| 手势 | 2D 折线图 | 网络图 / 3D（2D 散点图和柱状图以平移代替旋转） |
|---|---|---|
| 单指拖动（8 px 以上） | 平移 x，松手后带惯性 | 旋转相机 |
| 双指捏合 | 以双指中点为中心缩放 x | 相机缩放 |
| 双指拖动 | 平移 x | 相机平移 |
| 轻点 | 在该点固定提示框，直到下一次轻点 | 选择节点 + 提示框（`onNodeClick`） |
| 长按（450 ms） | 拖拽查看：提示框跟随手指，不平移 | 相同 |
| 双击 | 重置缩放 | 聚焦节点 |

```ts
sdk.enableNodeInteractions(canvas, {
  touch: { pinchZoom: true, tapTooltip: true, longPressScrub: true }, // 默认全部为 true；touch: false 关闭
});
```

## 事件

```ts
const off = sdk.on('rangechange', ({ xMin, xMax, yMin, yMax }) => {});
sdk.on('hover', ({ chart, node, clientX, clientY }) => {});
sdk.on('click', ({ chart, node, event }) => {});
off(); // 或 sdk.off(event, handler)
```

| 事件 | 负载 | 触发时机 |
|---|---|---|
| `hover` | `{ chart, node, clientX, clientY }` | 悬停目标变化；指针离开时为 `null`。需要 `enableNodeInteractions` |
| `click` | `{ chart, node, event }` | 无拖动的点击或轻点。需要 `enableNodeInteractions` |
| `rangechange` | `{ xMin, xMax, yMin?, yMax? }` | 可见范围变化（缩放、平移、重置、`setXRange`、范围选择器、数据流），每帧最多一次，且仅在实际变化时 |
| `legendtoggle` | `{ series, visible }` | 点击图例或调用 `setSeriesVisible` |
| `select` | `CharturboSelection` | 刷选确认或清除 |
| `themechange` | `CharturboTheme` | `setTheme` |
| `resize` | `{ width, height }` | 渲染目标尺寸变化（物理像素） |
| `drill` | `CharturboDrillEvent` | 矩形树图 / 旭日图下钻或上卷 |

- `chart` 为 `ChartTooltipContext`（图表悬停），`node` 为网络图节点或图表主数据点的 `NodeDetails`。
- 对于散点图以及折线图 / 面积图的 y 值域，`rangechange` 包含 `yMin` / `yMax`。
- 事件与 `onNodeHover` / `onNodeClick` 回调可同时使用。某个处理函数抛出异常不会中断其他处理函数，错误会被异步重新抛出。

## 应用自带指针处理时

如果应用自身也监听画布上的指针事件，请询问 SDK 哪些输入由它处理：

```ts
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' && sdk.handlesTouchGestures()) return; // 触摸 / 笔由 SDK 处理
  if (sdk.handlesChartBrush() && !e.altKey) return;                     // 拖动用于刷选
  if (sdk.handlesChartNavigation()) return;                             // 滚轮 / 拖动用于图表导航
  // 应用自身的处理
});
```

`handlesCameraControls()` 针对网络图和 3D 相机控制回答同样的问题。

## 另请参阅

- [提示框与悬停](./tooltips)
- [数据与坐标轴](./data-and-axes)：y 值域、范围选择器
- [仪表盘联动](./dashboard-sync)：在图表间共享光标和缩放
- [无障碍](./accessibility)：键盘导航
