# 标注

标注用于在 2D 图表上标记参考值：水平线和竖直线、x 区间和 y 区间、数据点标记以及自由文本。标注以数据单位放置，跟随缩放和平移，并裁剪到绘图区内。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { title: '延迟' });
sdk.setAnnotations([
  { type: 'hline', y: 250, label: 'SLO 250', dash: true, color: [0.94, 0.35, 0.33, 1], z: 'above' },
  { type: 'xband', from: 6800, to: 7000, label: '故障区间', opacity: 0.16 },
  { type: 'point', x: 6900, y: 312, width: 6 }, // 标记半径，CSS px
  { type: 'text', x: 100, y: 40, text: '发布 v2.3' },
]);
sdk.addAnnotation({ type: 'vline', x: new Date('2026-02-01'), labelPosition: 'start' });
sdk.render();
```

请在 render 调用之后调用 `setAnnotations`：渲染新图表会清除标注。

## 标注类型

| `type` | 字段 | 绘制内容 |
|---|---|---|
| `'hline'` | `y` | 水平参考线 |
| `'vline'` | `x` | 竖直参考线 |
| `'yband'` | `from`、`to` | 两个 y 值之间的水平区间 |
| `'xband'` | `from`、`to` | 两个 x 值之间的竖直区间 |
| `'point'` | `x`、`y` | 数据点标记 |
| `'text'` | `x`、`y`、`text` | 以该点为中心的文本 |

区间端点可以是 `Infinity` 或 `-Infinity`，此时区间延伸到绘图区边缘。

## 坐标

坐标使用当前图表的数据单位：

- 折线图和面积图：x 为样本索引；若图表带有 `x`，则为系列 `x` 值（时间轴为 epoch ms 或 `Date`）。y 为数值。
- 柱状图：x 为类目索引（允许小数）。设置 `orientation: 'horizontal'` 时，x 为数值，y 为类目索引。
- 散点图：x 和 y 值。
- K 线图、组合图和瀑布图按各自的坐标轴映射 x 和 y。

标注在上述图表的 2D 视图中生效。热力图、箱线图、饼图、雷达图、仪表盘、漏斗图、层级图表和 3D 图表不显示标注。支持对数轴和反向轴。

## 样式选项

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `color` | `ColorInput` | 主题 `baseline`（线、点），主题 `crosshair`（区间） | 线、标记或区间的颜色 |
| `width` | `number` | 线 `1.5`，点 `5`，区间 `0`（无边框） | 线 / 区间边框宽度（CSS px），或点的半径 |
| `dash` | `number \| boolean` | 无 | 虚线长度，CSS px；`true` = 6 px |
| `opacity` | `number` | 区间 `0.18`，其他 `1` | 透明度系数 |
| `label` | `string` | — | DOM 标签（小胶囊） |
| `labelPosition` | `'start' \| 'end' \| 'center'` | `'end'` | 标签沿线或区间的位置：start = 左 / 下，end = 右 / 上 |
| `z` | `'below' \| 'above'` | `'below'` | `'below'`：与网格线一起位于系列下方。`'above'`：位于系列上方、悬停层下方 |
| `yAxis` | `'left' \| 'right'` | `'left'` | 双 y 轴折线图中 `y` 与 y 区间所用的坐标轴 |

文本标注以纯文本绘制 `text`；其他类型以带标注颜色边框的胶囊绘制 `label`。

## 管理标注

```ts
sdk.setAnnotations(list);            // 全部替换
const i = sdk.addAnnotation(item);   // 追加并返回其索引
sdk.getAnnotations();                // 当前列表的副本
sdk.clearAnnotations();
sdk.render();
```

- 无效颜色会抛出错误，当前列表保持不变。
- 默认颜色跟随主题：`setTheme` 会重新着色未指定 `color` 的标注。

## 双 y 轴

在带右轴的折线图中，设置 `yAxis: 'right'` 后，`y`、`from`、`to` 按右轴读取。若没有右轴系列，则使用左轴。

```ts
sdk.setAnnotations([{ type: 'hline', y: 100, yAxis: 'right', label: '暴雨阈值' }]);
```

## 说明

- 引擎将数据单位映射到屏幕、裁剪图形并在 GPU 上绘制（区间三角形、线段、标记）。标签是放置在引擎报告的锚点处的 DOM 元素，仅在锚点移动时重新定位。
- 标签元素的 class 为 `charturbo-sdk-annotation-label`。
- SVG 导出包含标注。

## 另请参阅

- [数据与坐标轴](./data-and-axes)：双 y 轴、对数刻度
- [样式与主题](./styling)
- [导出：PNG · SVG · PDF](./export)
