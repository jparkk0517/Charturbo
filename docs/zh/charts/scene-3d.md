# 3D 场景 · 物理

除了图表和图，同一个画布还可以容纳一个 Three.js 风格的小型 3D 场景：基本几何体和自定义三角形网格，支持变换、父子层级、光照、PBR 风格材质、刚体物理和射线拾取。适用于空间视图、简单仿真，或为图提供 3D 背景。

[在线示例](https://jparkk0517.github.io/Charturbo/scene.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

sdk.setGraphVisible(false);                // 只显示场景
sdk.setRigidPhysics(true, [0, -40, 0]);    // 重力
sdk.setHelpers({ showGrid: true });

sdk.addPlane({ position: [0, -1, 0], scale: [160, 2, 160] });
sdk.addBox({ position: [0, 40, 0], scale: [10, 10, 10], bodyType: 'dynamic' });
sdk.addSphere({ position: [5, 70, 0], scale: [8, 8, 8], bodyType: 'dynamic', metallic: 0.6 });
sdk.setCameraPose([0, 55, 115], [0, 10, 0]); // eye, target

// 轨道旋转 / 平移 / 缩放；没有图节点，因此关闭节点提示框
const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });

const tick = () => {
  sdk.stepPhysics(1 / 60); // 推进刚体（图可见时也推进图布局）
  sdk.render();
  requestAnimationFrame(tick);
};
tick();
```

所有 `add*` 方法都返回新对象的数字 ID。

## 对象

| 方法 | 说明 |
| --- | --- |
| `addBox(desc?)` | 立方体 |
| `addSphere(desc?)` | 球体 |
| `addCylinder(desc?)` | 圆柱体 |
| `addPlane(desc?)` | 薄板；默认 `scale: [200, 2, 200]`、`color: [0.16, 0.21, 0.31, 1]` |
| `addPrimitive(desc)` | 通过 `shape: 'box' \| 'sphere' \| 'plane' \| 'cylinder'` 创建上述任一几何体 |
| `addCustomMesh(desc)` | 带索引的三角形网格 |

基本几何体为单位尺寸，因此 `scale` 就是对象在世界单位下的尺寸。

### 基本几何体选项（`PrimitiveObjectDescriptor`）

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | `'<SHAPE>_<id>'` | 保存在对象记录中的名称 |
| `shape` | `PrimitiveShape` | | 仅 `addPrimitive` 必填 |
| `position` | `[x, y, z]` | `[0, 0, 0]` | 位置 |
| `rotation` | `[rx, ry, rz]` | `[0, 0, 0]` | 欧拉角，弧度 |
| `scale` | `[x, y, z]` | `[10, 10, 10]` | 尺寸 |
| `color` | `RgbaTuple` | `[0.35, 0.68, 0.98, 1]` | `[0, 1]` 范围的 RGBA |
| `metallic` | `number` | `0.15` | 金属度 |
| `roughness` | `number` | `0.45` | 粗糙度 |
| `emissive` | `number` | `0` | 自发光 |
| `bodyType` | `'static' \| 'dynamic' \| 'kinematic'` | `'static'` | 刚体类型 |
| `velocity` | `[x, y, z]` | `[0, 0, 0]` | 初始线速度 |
| `angularVelocity` | `[wx, wy, wz]` | `[0, 0, 0]` | 初始世界空间角速度，弧度每秒 |
| `mass` | `number` | `max(0.2, abs(sx × sy × sz) × 0.01)` | 质量 |
| `restitution` | `number` | `0.55` | 弹性系数 |
| `parentId` | `number \| null` | `null` | 层级变换的父对象 |

### 自定义网格（`CustomMeshObjectDescriptor`）

```ts
const torus = sdk.addCustomMesh({
  name: 'torus',
  ...Charturbo.createTorusMesh(8, 2.6, 24, 48), // { positions, normals, indices }
  position: [0, 40, -10],
  color: [0.62, 0.5, 0.92, 1],
  metallic: 0.8,
  roughness: 0.2,
});
```

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `positions` | `Float32Array \| number[]` | （必填） | `[x0, y0, z0, ...]` 顶点位置 |
| `normals` | `Float32Array \| number[]` | | 顶点法线 |
| `indices` | `Uint32Array \| number[]` | （必填） | 三角形顶点索引 |
| `scale` | `[x, y, z]` | `[1, 1, 1]` | 缩放 |
| `color` | `RgbaTuple` | `[0.85, 0.45, 0.95, 1]` | RGBA |
| `metallic` / `roughness` | `number` | `0.35` / `0.3` | 材质 |
| `mass` / `restitution` | `number` | `2.0` / `0.6` | 物理 |

其余字段（`name` 默认 `'MESH_<id>'`、`position`、`rotation`、`emissive`、`bodyType`、`velocity`、`angularVelocity`、`parentId`）与基本几何体相同。`Charturbo.createTorusMesh(majorRadius = 8, minorRadius = 2.6, radialSegments = 18, tubularSegments = 32)` 用于生成测试网格。

### 编辑对象

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `setObjectTransform(id, { position?, rotation?, scale?, parentId? })` | `boolean` | 部分更新变换 |
| `getObjectTransform(id)` | `{ position, rotation, scale } \| null` | 当前变换（包含物理运动结果） |
| `setObjectMaterial(id, { color?, metallic?, roughness?, emissive? })` | `boolean` | 部分更新材质 |
| `setObjectPhysics(id, { bodyType?, velocity?, angularVelocity?, mass?, restitution? })` | `boolean` | 部分更新物理属性 |
| `setObjectParent(id, parentId \| null)` | `boolean` | 连接到父对象 / 解除连接 |
| `removeObject(id)` | `boolean` | 删除一个对象 |
| `clearScene()` | | 删除所有对象和当前图表 |
| `objectCount()` | `number` | 对象数量 |
| `getObjects()` / `getObjectRecord(id)` | `SceneObjectRecord[]` / `SceneObjectRecord \| null` | 包含当前变换的完整记录 |

接收 ID 的方法在 ID 未知时返回 `false`（或 `null`）。

## 光照与辅助显示

```ts
sdk.setLighting({ ambientIntensity: 0.3, directionalIntensity: 1, pointPosition: [0, 45, 25] });
sdk.setHelpers({ showGrid: true, gridSize: 160, gridDivisions: 16, showAxes: true });
```

`setLighting` 和 `setHelpers` 合并到当前值；`getLighting()` / `getHelpers()` 返回完整设置。

| 光照选项 | 类型 | 默认值 |
| --- | --- | --- |
| `ambientIntensity` | `number` | `0.32` |
| `directionalDirection` | `[x, y, z]` | `[0.45, 0.85, 0.55]` |
| `directionalIntensity` | `number` | `0.95` |
| `pointPosition` | `[x, y, z]` | `[0, 45, 25]` |
| `pointIntensity` | `number` | `0.65` |

| 辅助显示选项 | 类型 | 默认值 |
| --- | --- | --- |
| `showGrid` | `boolean` | `false` |
| `gridSize` | `number` | `200` |
| `gridDivisions` | `number` | `20` |
| `showAxes` | `boolean` | `false` |
| `axesLength` | `number` | `60` |

## 刚体物理

`setRigidPhysics(enabled, gravity?)` 开启或关闭仿真；默认开启，重力为 `[0, -40, 0]`。`getRigidPhysics()` 返回 `{ enabled, gravity }`。

- `stepPhysics(dt)` 推进场景。`dt` 被限制在 0.001..0.05 秒，并拆分为不超过 1/120 秒的子步。返回动能。
- `'dynamic'` 刚体受重力下落，并与其他所有刚体碰撞。`'kinematic'` 刚体不受重力，按自身的 `velocity` 和 `angularVelocity` 运动。`'static'` 刚体从不移动。
- 偏心碰撞会使物体旋转，摩擦使球体滚动。立方体使用有向接触流形；圆柱体按立方体碰撞；自定义网格使用其包围盒。
- 子对象（`parentId`）跟随父对象，不单独仿真。

## 拾取

```ts
sdk.enableNodeInteractions(canvas, {
  builtInTooltip: false,
  focusOnDoubleClick: false,
  onNodeClick: (_node, e) => {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    const hit = sdk.raycastObjectAtNdc(ndcX, ndcY); // { objectId, point } | null
    sdk.selectObject(hit?.objectId ?? null);         // 为命中的对象描边
  },
});
```

- `raycastObjectAtNdc(ndcX, ndcY)` 返回最近的命中对象和世界空间中的交点。球体和平面用解析法求交，立方体和圆柱体按立方体求交，自定义网格先做包围盒检测再逐个三角形求交。
- `pickObjectAtNdc(ndcX, ndcY)` 只返回对象 ID（没有时为 `null`）。
- `selectObject(id | null)` 高亮对象（大型静态平面只显示描边）。

## 保存与加载

`exportScene()` 返回可序列化的 `SceneDescriptor`（包含变换、材质和物理属性的对象，以及光照、辅助显示、刚体物理和图的可见性）。`loadScene(descriptor)` 清空场景、应用设置并重新创建对象，返回新的 ID 列表。

```ts
sdk.loadScene({
  lighting: { ambientIntensity: 0.3, directionalDirection: [0.4, 0.9, 0.5], directionalIntensity: 1, pointIntensity: 0.5 },
  helpers: { showGrid: true, gridSize: 160, gridDivisions: 16 },
  rigidPhysics: { enabled: true, gravity: [0, -40, 0] },
  graphVisible: false,
  objects: [
    { kind: 'primitive', name: 'floor', shape: 'plane', position: [0, -1, 0], scale: [160, 2, 160], roughness: 0.9 },
    { kind: 'primitive', name: 'step', shape: 'box', position: [-25, 5, 0], scale: [30, 10, 30] },
  ],
});

const saved = JSON.stringify(sdk.exportScene());
```

## 相机

场景使用与 [3D 网络图](./graph-3d#camera)相同的轨道相机：鼠标和触摸操作、`setCameraPose(eye, target)`、`rotateCamera`、`panCamera`、`zoomCamera` 和 `getCameraState()`。第一人称移动请使用 `moveCameraLocal(forward, right, up)` 和 `rotateCameraLook(deltaYaw, deltaPitch)`。

## 说明

- 不传 `nodeCount: 0, edgeCount: 0` 时，`Charturbo.create` 会生成一个 1000 节点的图。画布只显示场景时请调用 `setGraphVisible(false)`；也可以让可见的图与场景共用同一画布。
- 渲染图表（`render*Chart`）会使画布进入图表模式；内置相机操作只在没有图表时生效。

## 另请参阅

- [3D 网络图](./graph-3d)
- [交互](../guide/interactions)
- [性能](../guide/performance)
