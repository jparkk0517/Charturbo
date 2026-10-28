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

无效值会在调用处抛出异常：`animation: duration must be a finite number >= 0 (got …)` 或 `animation: unknown easing '…'`。

可在三处设置，越具体的设置优先级越高：

```ts
const sdk = await Charturbo.create(canvas, { animation: true }); // 整个 SDK，创建时
sdk.setAnimation({ duration: 900, easing: 'ease-in-out' });    // 整个 SDK，之后
sdk.renderBarChart(items, { animation: false });               // 仅此图表
```

- `setAnimation` 作用于当前图表及之后渲染的所有图表。
- 折线图、面积图、柱状图、分组柱状图、散点图、K 线图、OHLC、饼图和箱线图支持单图的 `animation` 选项。带状图、误差棒图和脉冲图不支持。

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
