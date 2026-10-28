# 3D 网络图

Charturbo 可以渲染大规模 3D 节点-连线图，并用 Rust 编写的 Barnes-Hut 力导向仿真（O(N log N) 八叉树）进行布局。适用于节点数从数千到数十万的服务拓扑、依赖关系图等网络，内置悬停提示框、邻居高亮、最短路径和搜索。

[在线示例](https://jparkk0517.github.io/Charturbo/graph.html)

## 基本用法

```ts
import { Charturbo, type RawGraphData } from 'charturbo';

const canvas = document.querySelector('canvas')!;
// nodeCount / edgeCount 为 0：从空图开始，而不是默认的种子图
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

const graph: RawGraphData = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), // 3 个节点
  edges: new Uint32Array([0, 1, 1, 2]),                       // 0-1、1-2
};
sdk.loadDataset(graph);
sdk.setNodeMetadata([
  { label: 'gateway', category: 'Ingress' },
  { label: 'auth', category: 'Service' },
  { label: 'db', category: 'Storage' },
]);

// 悬停提示框，单击 = 1 跳邻居，双击 = 聚焦，拖动 / 滚轮 = 相机
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });

sdk.setAutoSleep(true); // 布局稳定后停止仿真
sdk.warmup(40);         // 首帧前先让布局初步稳定
sdk.fitToView();

const tick = () => {
  if (!sdk.isSleeping()) {
    sdk.stepPhysics();
    sdk.render();
  }
  requestAnimationFrame(tick);
};
tick();
```

`detach()`（或 `sdk.dispose()`）会移除监听器和提示框。

## 数据格式

`loadDataset(data: RawGraphData)` 直接接收扁平的 TypedArray，不转换为对象：

| 字段 | 类型 | 长度 | 说明 |
| --- | --- | --- | --- |
| `positions` | `Float32Array` | `3 * N` | `[x0, y0, z0, x1, y1, z1, ...]` 初始坐标 |
| `masses` | `Float32Array` | `N` | 可选，默认 `1.0` |
| `colors` | `Float32Array` | `4 * N` | 可选，`[0, 1]` 范围的 RGBA |
| `clusters` | `Uint16Array` | `N` | 可选，聚类 ID |
| `edges` | `Uint32Array` | `2 * E` | 端点索引对 `[src0, dst0, src1, dst1, ...]` |
| `edgeWeights` | `Float32Array` | `E` | 可选，默认 `1.0` |

节点 ID 即这些数组中的索引。加载数据集会替换画布上的图表。

### 种子合成图

不调用 `loadDataset` 时，`Charturbo.create` 会按以下选项生成带聚类的随机图。传入 `nodeCount: 0, edgeCount: 0` 可从空图开始。

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `seed` | `number` | `42` | 随机种子 |
| `nodeCount` | `number` | `1000` | 节点数 |
| `edgeCount` | `number` | `2000` | 边数 |
| `clusterCount` | `number` | `8` | 聚类数 |

之后可用 `sdk.reloadSeededDataset(seed, nodeCount, edgeCount, clusterCount)` 重新生成。`sdk.generateDefaultMetadata(prefix?)` 为所有节点填充演示用的标签、类别、标签列表和属性（默认前缀 `'Service-Node'`）。

## 选项

### `enableNodeInteractions(canvas, options?)`

适用于图和 3D 视图的选项（`NodeInteractionOptions`；仅用于图表的选项见[交互](../guide/interactions)）：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `builtInTooltip` | `boolean` | `true` | 悬停时显示浮动 HTML 提示框 |
| `tooltipContainer` | `HTMLElement` | `canvas.parentElement` 或 `document.body` | 提示框挂载位置 |
| `highlightNeighborsOnClick` | `number` | `1` | 单击时高亮的跳数；`0` 表示关闭 |
| `focusOnDoubleClick` | `boolean` | `true` | 双击时相机移向该节点 |
| `autoRender` | `boolean` | `false` | 悬停 / 单击 / 相机变化时调用 `render()` |
| `formatTooltip` | `(details: NodeDetails) => string` | | 自定义提示框 HTML |
| `tooltipClassName` | `string` | | 额外的 CSS 类（基础类 `charturbo-sdk-node-tooltip`） |
| `tooltipStyle` | `Partial<CSSStyleDeclaration>` | | 合并到默认样式之上的内联样式 |
| `touch` | `false \| TouchInteractionOptions` | 全部开启 | 触摸 / 触控笔：拖动旋转、双指捏合缩放、双指拖动平移、轻点选择、双击聚焦 |
| `cameraControls` | `false \| CameraControlOptions` | 全部开启 | 鼠标相机操作，见[相机](#camera) |
| `onNodeHover` | `(details, pointer) => void` | | 悬停节点变化时触发（无节点时为 `null`） |
| `onNodeClick` | `(details, event) => void` | | 单击节点时触发；单击空白处为 `null` |

### 力参数

`setForceOptions(options: Partial<ForceOptions>)` 合并到当前值：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `repulsionStrength` | `number` | `25.0` | 节点间斥力 |
| `springStiffness` | `number` | `0.08` | 边弹簧刚度 |
| `springRestLength` | `number` | `8.0` | 边弹簧静止长度 |
| `centerGravity` | `number` | `0.03` | 指向原点的引力 |
| `damping` | `number` | `0.88` | 每步的速度阻尼 |
| `theta` | `number` | `0.75` | Barnes-Hut 张角（越大越快、越不精确） |

## 力导向仿真

| 方法 | 说明 |
| --- | --- |
| `stepPhysics(dt = 0.016)` | 同步执行一步 CPU 仿真，返回动能 |
| `warmup(ticks = 60, dt = 0.016)` | 一次执行多步 |
| `setAutoSleep(enabled, sleepThreshold = 0.05)` | 未固定节点的平均动能连续 30 步低于阈值后停止仿真。默认关闭 |
| `isSleeping()` / `wakeUp()` | 查询 / 解除休眠状态 |
| `exportPositions()` / `importPositions(positions)` | 以扁平 `Float32Array` 保存 / 恢复布局 |
| `pinNode(id, pinned)` | 将节点固定在原位 |
| `moveNode(id, x, y, z)` | 移动节点 |
| `setNodeStyle(id, { color?, mass?, clusterId? })` | 修改单个节点的颜色、质量或聚类 |

这些方法都不会渲染：调用后执行 `render()`（或使用 `autoRender`）。

### GPU 常驻布局

在 WebGPU 上，`stepPhysicsAsync` 把布局保留在 GPU 上：位置和速度留在 GPU 缓冲区中，GPU 每一步构建 Barnes-Hut 八叉树，并计算斥力、弹簧、积分和自动休眠判定。

```ts
if (sdk.supportsGpuPhysics()) console.log('可使用 GPU 布局');

const loop = async () => {
  if (!sdk.isSleeping()) {
    await sdk.stepPhysicsAsync(0.016); // 提交时即 resolve
    sdk.render();
  }
  requestAnimationFrame(loop);
};
loop();

// 在需要最新位置的拾取或导出之前
await sdk.syncPhysicsPositions();
const positions = sdk.exportPositions();
```

- `stepPhysicsAsync(dt)` 在该步提交后 resolve，返回最近一次回读布局的动能。它不会渲染。
- CPU 副本（供拾取、`exportPositions`、节点详情和 `isSleeping()` 使用）比 GPU 落后一到两帧。`await syncPhysicsPositions()` 会使其包含所有已提交的步；在 CPU 物理下不执行任何操作。
- CPU 编辑（`moveNode`、`pinNode`、`setNodeStyle`、`loadDataset`、`stepPhysics`）按调用顺序生效。只上传被编辑的节点（整体编辑后上传整个布局），待处理的 CPU 节点编辑优先于 GPU 状态。
- 开始下一步之前先 await 上一步；在上一步未完成时再次调用会抛出 `A physics step is already pending`。
- 在 WebGL2 和较旧的后端上，`stepPhysicsAsync` 回退到 CPU 物理。同步的 `stepPhysics()` 始终使用 CPU。
- 布局常驻 GPU 期间不进行视锥剔除（`setFrustumCulling`）。

::: warning 注意
改为 GPU 常驻后，`stepPhysicsAsync` 在提交时 resolve，而不是在回读之后；GPU 运行期间的 CPU 编辑按顺序生效，而不是使该步被拒绝。需要最新位置的地方请 await `syncPhysicsPositions()`。
:::

## 布局预设

`applyLayout(mode, spaceRadius = 85)` 立即放置所有节点：

| `mode` | 布局 |
| --- | --- |
| `'cluster-sphere'` | 按聚类分组排列在球面上 |
| `'radial-shells'` | 同心球壳 |
| `'helix'` | 螺旋线 |
| `'grid-3d'` | 3D 网格 |

预设是静态的。要把位置交回仿真，调用 `wakeUp()` 并持续调用 `stepPhysics()`。

```ts
sdk.applyLayout('cluster-sphere', 85);
sdk.fitToView();
sdk.render();
```

## 节点元数据与提示框

```ts
sdk.setSingleNodeMetadata(0, {
  label: 'API-Gateway-01',
  category: 'Ingress',
  description: '首尔区域主网关',
  tags: ['critical'],
  attributes: { latencyMs: 1.8, rps: 4200, status: 'Healthy' },
});
```

- `setNodeMetadata(metadata)` 替换全部元数据。接受以节点 ID 为索引的数组、`Map<number, NodeMetadata>` 或 `Record<number, NodeMetadata>`。
- `setSingleNodeMetadata(id, metadata)` 合并到单个节点。`getNodeMetadata(id)` 返回该值；未设置时返回 `{ label: 'Node #<id>' }`。
- `NodeMetadata`：`label`、`category`、`description`、`tags: string[]`、`attributes: Record<string, string | number | boolean>`。

`getNodeDetails(id)` 返回 `NodeDetails`（也会传给 `onNodeHover`、`onNodeClick` 和 `formatTooltip`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `number` | 节点 ID |
| `label` | `string` | 元数据标签或 `Node #<id>` |
| `position` | `[x, y, z]` | 当前位置 |
| `mass` | `number` | 质量 |
| `clusterId` | `number` | 聚类 |
| `color` | `RgbaTuple` | 颜色 |
| `degree` | `number` | 连接的边数 |
| `selected` / `pinned` | `boolean` | 状态标志 |
| `neighbors` | `number[]` | 相邻节点 ID |
| `metadata` | `NodeMetadata` | 元数据；`category` 默认为 `Cluster <id>` |

### 默认提示框

内置提示框以主题文字颜色显示标签和 `#id`、类别和聚类、连接度、邻居数、坐标、标签列表以及最多 6 个属性。所有来自数据的字符串（标签、类别、标签列表、属性键和值）都会进行 HTML 转义，因此像 `<img onerror=…>` 这样的标签也只显示为文本。固定文案跟随 SDK / 图表的语言区域（见[国际化](../guide/i18n)），数字使用该语言区域的格式。

`setNodeHoverStyle({ enabled?, scale?, color? })` 修改悬停标记。默认将悬停节点放大 1.6 倍并提亮其自身颜色。

### 自定义提示框

`formatTooltip` 返回的 HTML 会原样写入 `innerHTML`。请用导出的 `escapeHtml` 包裹数据字符串：

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  formatTooltip: (d) =>
    `<b>${escapeHtml(d.label)}</b><div>${escapeHtml(d.metadata.category ?? '')} · ${d.degree} links</div>`,
});
```

## 选择、路径与搜索

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `highlightNeighbors(id, hops = 1)` | `Uint32Array` | 选中节点及 `hops` 跳以内的邻居（`0` = 仅该节点） |
| `highlightShortestPath(start, end)` | `Uint32Array` | 无向 BFS 最短路径并高亮；不连通时为空 |
| `selectCluster(clusterId)` | `Uint32Array` | 选中一个聚类 |
| `boxSelect(minX, minY, maxX, maxY)` | `Uint32Array` | NDC 矩形内的节点 |
| `queryRadius(x, y, z, radius, maxResults = 100)` | `Uint32Array` | 球体内的节点 |
| `pickNodeAtNdc(ndcX, ndcY)` | `number \| null` | NDC 点下方的节点 |
| `clearSelection()` | | 清除选择 |
| `searchNodes(query, limit = 25)` | `NodeDetails[]` | 先匹配数字 ID（`42` 或 `#42`），再对标签、类别、描述和标签列表做不区分大小写的子串匹配 |
| `projectNodeToScreen(id, w, h)` | `{ x, y, ndcZ } \| null` | 画布像素位置；在相机后方时为 `null` |
| `projectNodesToScreen(ids, w, h)` | `Float32Array` | 一次 WebAssembly 调用返回 `[x0, y0, x1, y1, ...]`；相机后方为 `NaN` |

```ts
const path = sdk.highlightShortestPath(0, 1999);
console.log(`${path.length - 1} hops`);

for (const node of sdk.searchNodes('vector db', 4)) {
  sdk.focusNode(node.id);
  sdk.highlightNeighbors(node.id, 1);
}
sdk.render();
```

## 相机 {#camera}

内置相机操作（`cameraControls`）作用于未显示 2D 图表时的图、点云和 3D 场景视图：

| 输入 | 动作 |
| --- | --- |
| 左键拖动 | 轨道旋转 |
| Shift + 拖动、右键拖动、中键拖动 | 平移（指针下的内容跟随指针） |
| 滚轮 | 按当前距离比例缩放；页面不会滚动 |
| 双击 | 聚焦到节点（`focusOnDoubleClick`） |

- 拖动期间会捕获指针，因此在画布外松开也会结束拖动。在按下位置 5 px 以内松开视为单击。
- `{ orbit: false }` 使左键拖动变为平移（2D 式浏览）。`{ pan: false }` / `{ zoom: false }` 仅关闭对应动作。`cameraControls: false` 关闭所有内置相机移动，适合自行控制相机的宿主。同样的开关也作用于触摸手势。
- 为了支持右键拖动平移，图视图中不会弹出画布的上下文菜单。
- 有自己指针处理程序的宿主可以在 `sdk.handlesCameraControls()` 返回 `true` 时跳过相机处理。

```ts
sdk.fitToView();                      // 从当前方向让所有节点充满视图（留 10 % 边距）
sdk.focusNode(42);                    // 移向节点并靠近到概览距离的 40 %
sdk.focusNode(42, { distance: 60 });  // 指定距离（`false` = 保持距离）
const cam = sdk.getCameraState();     // { projection, target, eye, distance, yaw, pitch, fovY, aspect } | null
sdk.setCameraPose([0, 50, 160], [0, 0, 0]); // eye, target
```

- `fitToView()` 按水平和垂直视场中较紧的一方确定让所有节点充满视图的距离，因此宽画布也能填满。它同时设定 `focusNode` 使用的概览距离。
- `focusNode` 和双击聚焦会移动目标并靠近到概览距离（最近一次 `fitToView` / `setCameraPose`）的 40 %，不会比当前更远。移动立即完成。ID 未知时返回 `false`。
- 编程控制：`rotateCamera(deltaYaw, deltaPitch)`、`panCamera(deltaRight, deltaUp)`、`zoomCamera(delta)`。

## 说明

- 视锥剔除默认关闭；`setFrustumCulling(true)` 为 CPU 布局开启剔除。
- `getCameraState()`、基于距离的缩放 / 平移和聚焦距离需要带 `camera_state` 绑定的引擎构建；没有该绑定时分别返回 `null`、使用固定增益、只移动目标。
- `setGraphVisible(false)` 隐藏图并停止其仿真，例如画布只显示 [3D 场景](./scene-3d)时。

## 另请参阅

- [嵌入向量 · 相似度](./embeddings)
- [3D 场景 · 物理](./scene-3d)
- [提示框与悬停](../guide/tooltips)
- [性能](../guide/performance)
