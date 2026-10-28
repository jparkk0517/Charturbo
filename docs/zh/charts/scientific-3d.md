# PointCloud3D · Surface3D

`renderPointCloud3D` 将相互独立的 XYZ 样本绘制为朝向屏幕的点，`renderSurface3D` 将 Y-up 高度网格绘制为带光照和色图的曲面。适用于需要真实 X/Y/Z 坐标轴、拾取和数据流更新的实测 3D 数据（扫描、轨迹、仿真结果），而不是力导向图。

[在线示例](https://jparkk0517.github.io/Charturbo/scientific3d.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
// nodeCount / edgeCount 为 0：不生成默认的种子图
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

sdk.renderPointCloud3D([
  { name: 'Scan', data: new Float32Array([0, 1, 2, 3, 4, 5]), size: 5 },
  { name: 'Reference', data: [{ x: 1, y: 2, z: 3 }], color: '#ff9933', size: 10 },
], { title: 'XYZ 点云', legend: true });

// 轨道旋转 / 平移 / 缩放、悬停提示框、键盘浏览
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

曲面的用法相同：

```ts
sdk.renderSurface3D([{
  name: 'Height',
  data: { columns: 3, rows: 2, xStart: -1, xStep: 1, zStart: 0, zStep: 2,
    y: [0, 1, 0, 1, 2, 1] },
  colormap: 'viridis', lighting: 0.65,
  contours: { show: true, levels: 8, color: '#f8fafc' },
}], { title: 'Y-up 曲面', showGrid: true });
sdk.render();
```

两个方法都返回 `{ pointCount, seriesCount }`。坐标为 Y-up。原始 XYZ 值与渲染坐标分开保存，因此提示框、键盘焦点和 CSV 导出始终显示原始值。内部渲染坐标为 Float32 精度。

## 数据格式

### 点云（`PointCloud3DSeries.data`）

接受以下任一形式：

| 形式 | 示例 |
| --- | --- |
| 交错排列的 `Float32Array` 或 `Float64Array` | `new Float32Array([x0, y0, z0, x1, y1, z1])` |
| 元组数组 | `[[x, y, z], ...]` |
| 对象数组 | `[{ x, y, z }, ...]` |
| 等长的列 | `{ x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number> }` |

`null` 项或非有限坐标视为空缺（gap）：不绘制，但其余样本保留原始 ID。

### 曲面（`Surface3DSeries.data`）

```ts
interface Surface3DGridData {
  columns: number; // >= 2
  rows: number;    // >= 2
  xStart: number; xStep: number; // 有限的起点，非零步长（可为负）
  zStart: number; zStep: number;
  y: ArrayLike<number>;           // 行优先：y[row * columns + column]
}
```

只要有一个顶点不是有限值，该单元格就成为空洞（hole）。

一个图表最多容纳 4,000,000 个样本。

## 选项

### 系列选项

两种系列通用：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | | 图例和提示框中的名称 |
| `color` | `ColorInput` | 调色板 | 系列颜色 |
| `visible` | `boolean` | `true` | 初始可见性 |
| `opacity` | `number` | | 系列不透明度 |

`PointCloud3DSeries`：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `data` | `PointCloud3DData` | | XYZ 样本（见上文） |
| `size` | `number` | `3` | 点的直径，CSS 像素 |
| `colorBy` | `{ values, colormap?, min?, max? }` | | 每个点一个标量，通过 `'viridis'`（默认）或 `'magma'` 映射。`min` / `max` 固定颜色范围 |

`Surface3DSeries`：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `data` | `Surface3DGridData` | | 高度网格 |
| `colormap` | `'viridis' \| 'magma'` | `'viridis'` | 高度色图。只指定 `color` 而不指定 `colormap` 时为纯色 |
| `yMin` / `yMax` | `number` | 数据范围 | 色图的颜色范围 |
| `wireframe` | `boolean` | `false` | 绘制网格线而不是填充单元格 |
| `lighting` | `number` | `0.65` | 平面漫反射光照，0..1 |
| `contours` | `Surface3DContourOptions` | | 等高线，见[等高线](#contours) |

### 图表选项（`Scientific3DChartOptions`）

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `title` | `string` | | 图表标题 |
| `description` | `string` | | 无障碍描述 |
| `legend` | `boolean \| ChartLegendOptions` | | 系列图例 |
| `grid` | `ChartGridStyle` | | 网格线样式 |
| `showGrid` | `boolean` | | 显示网格 |
| `hover` | `ChartHoverStyle` | | 悬停标记样式 |
| `axes3d` | `{ x?, y?, z? }` | | 各坐标轴的范围、名称、刻度和可见性 |
| `aspect` | `'cube' \| 'data' \| [x, y, z]` | `'cube'` | 包围盒比例 |
| `camera` | `Scientific3DCameraOptions` | | 投影方式和初始位姿 |

相机是归一化渲染空间中的 Y-up 轨道相机。调整画布尺寸后仍保留旋转、平移、距离和投影大小。

## 坐标轴范围、比例与正交投影

```ts
sdk.renderPointCloud3D([{ data: measuredXYZ, size: 4 }], {
  axes3d: {
    x: { name: 'X', min: 0, max: 120, tickCount: 4 },
    y: { min: 0, max: 40, tickCount: 3 },
    z: { min: 0, max: 20, tickCount: 3 },
  },
  aspect: 'data', // 'cube'（默认）或 [2, 1, 0.5] 这样的相对 XYZ 包围盒长度
  camera: { type: 'orthographic' }, // 默认透视投影；省略 orthoSize 时自动取景
});
```

`axes3d.x` / `y` / `z`（`Scientific3DAxisOptions`）：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | | 坐标轴名称 |
| `min` / `max` | `number` | 数据范围 | 以数据单位表示的固定框架范围 |
| `tickCount` | `number` | `5` | 整数 2..50，在范围内均匀分布 |
| `visible` | `boolean` | `true` | 为 `false` 时隐藏该轴的刻度及其方向的网格 |

- 省略的端点取所有有限样本（包括隐藏系列）的范围。两端都指定时必须满足 `min < max`。只固定一端且自动端越过它时，自动端按固定值的 5 %（至少 1 个单位）扩展。
- 固定范围是**坐标轴框架**，不会裁剪范围外的几何体。
- 坐标轴标签是 DOM 元素。整体网格由 `showGrid` 控制。
- `aspect: 'cube'` 将每个轴独立归一化到 `[-60, 60]`。`aspect: 'data'` 使用各轴范围长度的比例，使相同的数据单位长度相同。数字元组表示正的相对包围盒长度。最长边为 120 个渲染单位。提示框、CSV 和无障碍输出保留原始 XYZ。
- 数据流更新时保留固定端点，只重新计算自动端点。

`camera`（`Scientific3DCameraOptions`）：

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `type` | `'perspective' \| 'orthographic'` | `'perspective'` | 投影方式 |
| `eye` | `[x, y, z]` | 适配数据包围盒 | 渲染空间中的视点位置 |
| `target` | `[x, y, z]` | `[0, 0, 0]` | 渲染空间中的轨道目标，需要同时指定 `eye` |
| `orthoSize` | `number` | 自动 | 初始垂直半高（仅正交投影，正数），随滚轮缩放变化 |

正交投影下的拾取对每个屏幕位置使用平行射线。`getCameraState()` 返回 `projection` 和 `orthoSize`。切换到其他图表时恢复透视投影。

## 等高线 {#contours}

曲面系列的 `contours: { show?, levels?, color?, width?, opacity? }` 用于绘制高度等高线。

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `show` | `boolean` | `false` | 显示等高线 |
| `levels` | `number \| number[]` | `12` | 整数 1..64：在 `yMin..yMax`（省略时为有限高度范围）内部均匀划分，不含两端；范围只有一个值时即为该值。有限数字数组：直接使用原始 Y 高度 |
| `color` | `ColorInput` | `'#e2e8f0'` | 线条颜色 |
| `width` | `number` | `1.5` | 视觉权重，不是 CSS 像素宽度：线条为 1 px 细线，alpha 为 `min(1, opacity × colorAlpha × (0.75 + 0.15 × min(width, 4)))` |
| `opacity` | `number` | `0.85` | 0..1 |

无效值在渲染前被拒绝。等高线在实际渲染的三角形上用 marching triangles 生成，并使用与曲面相同的坐标映射，因此在固定 `axes3d`、任意 `aspect` 和正交投影下都贴合曲面。空洞单元格不绘制；等高线跟随系列可见性和强调状态，参与深度测试，但不可拾取。`updateSurface3D` 会根据更新后的高度和 `yMin` / `yMax` 重新计算按数量指定的 levels。

## 数据流更新

```ts
// 追加到点云系列 0；返回该系列保留的样本数
sdk.appendPointCloud3D(0, new Float32Array([1, 2, 3, 4, 5, 6]), { maxPoints: 2400 });
// 使用 colorBy 的系列需要为每个追加的点提供一个 colorValues：
// sdk.appendPointCloud3D(0, xyz, { maxPoints: 2400, colorValues: scalars });
sdk.render();

// 作用于已渲染的曲面（与上面的点云是不同的图表）
sdk.updateSurface3D(0, { mode: 'replaceY', y: heights, yMin: -1, yMax: 1 });
sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 1, y: nextColumn });
sdk.updateSurface3D(0, { mode: 'appendRows', rows: 1, y: nextRow, scrollZ: false });
sdk.render();
```

### `appendPointCloud3D(seriesIndex, data, options?)`

接受与 `renderPointCloud3D` 相同的 XYZ 形式，返回该系列保留的样本数。

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `maxPoints` | `number` | `0`（不限） | 只保留最新的 N 个样本 |
| `colorValues` | `ArrayLike<number>` | | 系列使用 `colorBy` 时必填（每个追加的点一个），否则不能传入 |

保留色图和固定的 `min` / `max`；自动颜色范围根据保留的标量重新计算。

### `updateSurface3D(seriesIndex, update)`

返回该系列的 `{ columns, rows, pointCount }`。

| `mode` | 字段 | 说明 |
| --- | --- | --- |
| `'replaceY'` | `y`、`yMin?`、`yMax?` | 替换全部高度（行优先，`rows * columns`）。`yMin` / `yMax` 在之后的更新中保持；省略时沿用当前设置 |
| `'appendColumns'` | `columns`、`y`、`scrollX?` | `y` 为列优先条带：`y[newColumn * rows + row]` |
| `'appendRows'` | `rows`、`y`、`scrollZ?` | `y` 为行优先块：`y[newRow * columns + column]` |

`scrollX` / `scrollZ` 为 `true`（默认）时网格尺寸不变：丢弃最旧的列 / 行，原点移动 `追加数量 × step`。大于窗口的数据块只保留最后一个窗口。为 `false` 时原点固定，网格扩大。支持负步长。

### 更新规则

- 更新是原子的。长度、范围、类型、系列索引错误或后端不支持时，拒绝更新且不改变当前数据。
- 输入会被复制，之后修改原数组不影响图表。单个数据块和整个图表各自最多 4,000,000 个样本。允许空追加（仍会应用更小的点云 `maxPoints`）。
- 保留相机、样式、可见性、强调状态和固定的坐标轴端点。自动范围根据全部保留数据重新计算。ID 按当前系列顺序和样本位置重新编号。已固定的提示框或键盘焦点会被释放；CSV、无障碍和提示框使用更新后的 XYZ。
- 当前实现会复制 SDK 元数据，把变更的系列重新传给 WebAssembly，由 Rust 重新计算范围和几何体。不保证 GPU 局部上传或 O(追加量) 的开销。

## 交互与导出

- 调用 `enableNodeInteractions(canvas, { autoRender: true })` 后可以轨道旋转（左键拖动）、平移（Shift / 右键 / 中键拖动）和缩放（滚轮）。相机操作见 [3D 网络图](./graph-3d#camera)。
- 点云拾取返回容差半径内最靠前的样本。曲面拾取与三角形求交，返回 `point3d: { x, y, z, column, row }`。线框曲面也能拾取单元格内部。
- 键盘浏览和 CSV 提供未插值的原始顶点 XYZ。
- SVG 导出回退为栅格图像；PNG 和 PDF 保存当前 3D 画面。

## 在框架中使用

React 和 Vue 支持 `type="pointCloud3d"` 和 `type="surface3d"`，`options` 相同。更新时把完整数据再次传给渲染 API。数据流更新时，在 `onReady(sdk)` 或组件 ref 的 `whenReady()` 得到的 SDK 上调用 `appendPointCloud3D` / `updateSurface3D` 和 `render()`，并保持 `data` / `options` prop 的引用不变：传入新引用会重新执行完整的渲染 API。

## 说明

- 目前悬停检测会检查所有点 / 单元格。
- 半透明几何体会写入深度但不做深度排序，不支持精确的多层透明合成。
- 尚未提供：3D 刷选和联动、等高线标签、FOV / near / far / up 相机设置、nice ticks、GPU 字形标签、独立的包围盒开关。

## 另请参阅

- [3D 网络图](./graph-3d)
- [交互](../guide/interactions)
- [导出：PNG · SVG · PDF](../guide/export)
- [React](../guide/react) · [Vue](../guide/vue)
