# 动画

可选开启的入场（enter）与更新（update）动画：折线从左到右展开，柱子从基线长出，点和饼图扇区淡入并缩放出现，数据更新时补间过渡到新值。默认关闭。引擎在 Rust 中对暂存（staged）的 GPU 图元做插值，因此大数据量下开销依然很小。

[在线示例](https://jparkk0517.github.io/Charturbo/animation.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { animation: { duration: 600, easing: 'ease-out' } });

const categories = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const random = () => categories.map(() => 20 + Math.round(Math.random() * 80));
function draw() {
  sdk.renderGroupedBarChart(
    { categories, series: [{ name: '本周', values: random() }, { name: '上周', values: random() }] },
    { title: '每日订单数' }
  );
  sdk.render();
}

draw();                                                  // 首次渲染：柱子从基线长出
document.querySelector('button')!.onclick = draw;        // 形状相同：柱高补间过渡
```

## 设置

动画设置可以是 `true`（400 ms，`'ease-out'`）、`false`（关闭）或选项对象：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `duration` | `number` | `400` | 时长（ms）。必须是 ≥ 0 的有限数；`0` 表示关闭。 |
| `easing` | `'linear' \| 'ease-out' \| 'ease-in-out' \| 'ease-in'` | `'ease-out'` | 缓动曲线。 |
| `transition` | `boolean` | `false` | 变形为配对类型（柱状图 ↔ 饼图、矩形树图 ↔ 旭日图）的下一张图表。参见[过渡](#过渡)。 |

无效值会在调用处抛出异常：`animation: duration must be a finite number >= 0 (got …)` 或 `animation: unknown easing '…'`。

可在三处设置，越具体的设置优先级越高：

```ts
const sdk = await Charturbo.create(canvas, { animation: true }); // 整个 SDK，创建时
sdk.setAnimation({ duration: 900, easing: 'ease-in-out' });    // 整个 SDK，之后
sdk.renderBarChart(items, { animation: false });               // 仅此图表
```

- `setAnimation` 作用于当前图表及之后渲染的所有图表。
- 折线图、面积图、柱状图、分组柱状图、散点图、K 线图、OHLC、饼图、箱线图、矩形树图和旭日图支持单图的 `animation` 选项。带状图、误差棒图和脉冲图不支持。

## 方法

| 方法 | 说明 |
|---|---|
| `setAnimation(animation)` | 整个 SDK 的设置：`true` / `false` / `{ duration, easing }`。 |
| `getAnimation()` | 解析后的 SDK 设置（`{ duration, easing }`），关闭时为 `null`。 |
| `isAnimating()` | 图表动画播放中时为 `true`。 |
| `finishAnimation()` | 将正在播放的动画直接跳到最终帧。需调用 `render()` 才会显示。 |

## 入场动画

首次渲染图表，或以不同类型渲染时：

| 图元 | 入场效果 |
|---|---|
| 折线、面积、K 线 | 通过裁剪（scissor）矩形从左到右展开；几何体不变。 |
| 柱子 | 从 0 基线长出。堆叠柱整根一起长出。 |
| 散点、饼图扇区 | 淡入并缩放出现。 |
| 其他图元（箱线图等） | 淡入。 |

## 更新动画

调用 `setSeriesData` 之后，或以相同类型、相同形状（每个图层的暂存实例数相同）重新渲染图表时，会播放更新动画：

```ts
sdk.setSeriesData(0, next);
sdk.render(); // y 值从上一帧补间过渡
```

- 引擎对上一帧的暂存实例逐元素插值：折线顶点（y 值）、柱子矩形（高度）、散点中心。饼图对扇区角度插值并重新三角剖分。
- 形状发生变化的图层直接跳到最终值；图表类型不同时播放入场动画。
- 坐标轴和刻度立即切换到新的值域。

## 柱状图竞赛

`renderBarChart`（水平或垂直）的 `realtimeSort` 在每次渲染时按数值从大到小排序柱子。开启动画时，每根柱子从上一张图表中同一*标签*所在的位置补间，而不是按索引，因此逐年重新渲染就形成了竞赛：

```ts
const draw = (year: number) => {
  sdk.renderBarChart(rows(year), {
    title: `Users, ${year}`,
    orientation: 'horizontal',
    labels: true,
    realtimeSort: { max: 8 },                     // 只保留前 8 名
    animation: { duration: 900, easing: 'linear' },
  });
  sdk.render();
};
setInterval(() => draw(++year), 1000);
```

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `realtimeSort` | `boolean \| { max?, valueAnimation? }` | 关闭 | `true` 对所有柱子排序。 |
| `realtimeSort.max` | `number` | 全部 | 只保留最大的 N 根柱子（≥ 1 的整数）。 |
| `realtimeSort.valueAnimation` | `boolean` | `true` | 数值标签从同一标签的上一个值递增计数。 |

- 柱子按标签配对。新进入的标签从最后一根柱子之后的位置滑入并淡入；退出的标签滑到该位置并淡出。
- 类目标签和数值标签随柱子移动。数值轴立即切换到新的值域。
- 按键补间仅在 2D 柱状图中运行；`viewMode: '3d'` 时只排序并截取。不设置 `realtimeSort` 时，柱子与以前一样保持数据顺序并按索引补间。

## 折线竞赛

`renderLineChart` 的 `endLabel` 在每条折线末端显示系列名称和最后一个值。在从左到右展开期间，标签跟随展开前沿移动，因此较长的 `duration` 会让折线形成竞赛：

```ts
sdk.renderLineChart(series, {
  legend: false,
  endLabel: true,                                  // 或 { format: (value, name) => `${name}: ${value}` }
  animation: { duration: 4000, easing: 'linear' },
});
```

- 默认文本为 `名称 数值`，数值使用 y 轴格式。右侧内边距会增大以容纳标签。
- 仅适用于 2D 折线图；面积图不支持 `endLabel`。

## 过渡

动画设置中含 `transition: true` 时，将同一数据重新渲染为配对类型会逐个图元变形，而不是播放入场动画：

```ts
const animation = { duration: 800, transition: true };
sdk.renderBarChart(labels.map((label, i) => ({ label, value: values[i] })), { animation });
sdk.render();
sdk.renderPieChart({ labels, values }, { animation }); // 每根柱子变形为对应的扇区
sdk.render();
```

| 起点 ↔ 终点 | 图元配对依据 |
|---|---|
| 柱状图 ↔ 饼图 | 类目标签 = 扇区标签。 |
| 矩形树图 ↔ 旭日图 | 节点路径（从根开始的名称）。 |

- 每个图元都转换为由 24 个点组成的内边和外边构成的多边形（柱子：基线 → 数值端；扇区或弧段：内弧 → 外弧；矩形树图单元：底边 → 顶边）。矩形和环形扇区共享这种形状，因此引擎只需在 Rust 中逐点插值两条边：每帧无需重采样、对应点搜索或重新三角剖分，且每一帧都是有效的形状。
- 没有配对对象的图元在原地淡入或淡出。
- 变形过程中图元没有圆角和抗锯齿轮廓，数据标签和坐标轴已经处于最终布局。
- 图元超过 2,000 个的图表不进行变形，而是播放入场动画。
- 其他类型切换以及 `transition: false`（默认）的行为与以前相同。

### 竞赛与过渡期间

- 悬停、点击和提示框按最终布局进行命中测试，而不是按移动中的图元。
- 无障碍（屏幕阅读器摘要和数据表）描述的是最终数据；递增计数的标签仅用于显示。
- `prefers-reduced-motion: reduce` 会关闭补间、递增计数和变形：图表直接显示排序后的最终状态。

## 开销

- 插值在 Rust 中进行，只处理细节层次（LOD）裁减后的暂存图元：O(可见)。100 万点的折线图也只需对 M4 抽稀后剩下的几千个顶点插值。
- 暂存图元超过 50,000 个时（例如 100 万点的散点图）会跳过动画。
- `requestAnimationFrame` 只在动画播放期间运行，没有空闲循环。没有 `requestAnimationFrame` 或标签页处于隐藏状态时，直接显示最终帧。

## 说明

- `prefers-reduced-motion: reduce` 会关闭动画。
- 由于默认关闭，视觉回归测试用例的结果是确定的。
- 图片、SVG、PDF [导出](./export)始终使用最终帧。

## 另请参阅

- [实时数据流](./streaming)
- [导出：PNG · SVG · PDF](./export)
- [无障碍](./accessibility)
- [性能](./performance)
