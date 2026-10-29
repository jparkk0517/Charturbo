# 象形柱图

`renderPictorialBarChart` 绘制用符号表示柱子的柱状图（ECharts `pictorialBar`）：内置形状或 SVG 路径，可以拉伸铺满每根柱子，也可以沿柱子重复，并可在数值处裁剪。其余部分与 2D [柱状图](./bar)相同：坐标轴、方向、分组/堆叠/百分比系列、标签、悬停、图例和无障碍。

[在线示例](https://jparkk0517.github.io/Charturbo/bar.html#06-pictorial)

## 基本用法 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPictorialBarChart(
  [
    { label: '周一', value: 72 },
    { label: '周二', value: 45 },
    { label: '周三', value: 90 },
  ],
  {
    background: true,
    symbol: 'roundRect',
    symbolRepeat: 'fixed',
    symbolClip: true,
    symbolBoundingData: 100,
    symbolSize: ['70%', 10],
    symbolMargin: 2,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderPictorialBarChart(
  data: PictorialBarItem[] | PictorialBarChartData,
  options?: PictorialBarChartOptions
): { barCount: number }
```

## 数据格式 {#data-format}

数据与柱状图相同：数据项数组（`renderBarChart`）或 `{ categories, series }`（`renderGroupedBarChart`）。数据项和系列也可以设置下面的符号选项。最具体的设置优先：数据项，其次系列，最后图表选项。

```ts
sdk.renderPictorialBarChart([
  { label: '点赞', value: 40, symbol: 'path://M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
  { label: '流失', value: -20, symbol: 'arrow' },
]);
```

## 选项 {#options}

`PictorialBarChartOptions` 接受所有[柱状图选项](./bar#options)（仅 2D），另加以下符号选项：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `symbol` | `'circle' \| 'rect' \| 'roundRect' \| 'square' \| 'triangle' \| 'diamond' \| 'arrow' \| 'pin' \| 'none' \| 'path://…'` | `'circle'` | 形状。`path://` 接受 SVG 路径数据（`M L H V C S Q T A Z`，绝对和相对坐标，nonzero 填充）；路径会缩放到符号框，不保持宽高比。 |
| `symbolSize` | `number \| '50%' \| [w, h]` | `['100%', '100%']` | 屏幕上的符号尺寸。横跨柱子方向的百分比相对柱子粗细；沿柱子方向相对柱子长度（或 `symbolBoundingData` 的长度），重复时相对柱子粗细。 |
| `symbolRepeat` | `boolean \| number \| 'fixed'` | `false` | `false`：一个符号。`true`：沿柱子长度重复。数字：重复这么多个。`'fixed'`：不论数值，按边界长度能放下多少就放多少。 |
| `symbolMargin` | `number \| '15%'`，可带 `!` | `'15%'` | 重复符号两侧的间距，单位 px 或沿柱子方向符号尺寸的百分比。间距会重新分配以铺满长度。末尾加 `!`（`'10%!'`）时两端也保留间距。 |
| `symbolClip` | `boolean` | `false` | 在数据值处裁剪符号。与 `'fixed'` 或 `symbolBoundingData` 一起使用可得到“液位”效果。 |
| `symbolPosition` | `'start' \| 'end' \| 'center'` | `'start'` | 单个符号或重复序列在柱子上的位置。 |
| `symbolOffset` | `number \| '50%' \| [x, y]` | `0` | 屏幕偏移（向右、向下），单位 px 或符号尺寸的百分比。 |
| `symbolRotate` | `number` | `0` | 旋转角度（度），正值为逆时针。 |
| `symbolBoundingData` | `number \| [负值, 正值]` | 无 | 按此值而不是柱子数值布局符号。给出一对值时，负值柱用第一个，正值柱用第二个。 |

- 数值为负的柱子朝反方向，符号也随之镜像。
- `background`（见[背景轨道](./bar#background-tracks)）在符号后面绘制阴影柱。
- 无效的符号选项、`image://` 符号和 `viewMode: '3d'` 会在替换当前图表之前抛出异常。

## 条形图 {#horizontal-bars}

```ts
sdk.renderPictorialBarChart(items, {
  orientation: 'horizontal',
  symbol: 'path://M12 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM8 9h8a2 2 0 0 1 2 2v5h-2.5v7h-7v-7H6v-5a2 2 0 0 1 2-2z',
  symbolRepeat: true,
  symbolClip: true,
  symbolSize: [16, '80%'],
  symbolMargin: '10%',
});
```

此时“沿柱子方向”是 x 轴：`symbolSize[0]` 是沿柱子方向的尺寸，`symbolSize[1]` 是横跨方向的尺寸。

## 悬停与动画 {#hover-and-animation}

- 悬停和提示框与柱状图相同。悬停柱子的符号会高亮，图例会淡化其他系列。
- 重新渲染时符号从旧柱子过渡到新柱子，入场动画从基线生长。重复符号每帧重新布局，因此生长中的柱子会增加符号而不是拉伸符号。

## 无障碍与导出 {#accessibility-and-export}

图表沿用柱状图的摘要（名为“象形柱图”）、数据表和键盘导航。CSV 导出包含柱子数值，SVG 导出把符号写成矢量路径。React 和 Vue 组件接受 `type: 'pictorialBar'` 以及 `data` 和 `options`。

## 限制 {#limitations}

- 不支持 `image://` 符号。
- 不支持 `symbolKeepAspect`、`symbolPatternSize` 和系列重叠（`barGap: '-100%'`）。
- 仅限 2D。直方图、瀑布图和组合图不能绘制为象形柱图。

## 另请参阅 {#see-also}

- [柱状图](./bar)
- [直方图](./histogram)
