# 仪表盘联动

同一页面上的图表可以共享悬停光标和 x 轴缩放 / 平移。每个图表保留各自的画布和引擎，彼此之间只传递数据单位的位置。适用于仪表盘以及共享 x 轴的小型多图。

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvases = [cpuCanvas, memCanvas, netCanvas];
const data = [cpuSeries, memSeries, netSeries];
const charts = await Promise.all(canvases.map((c) => Charturbo.create(c)));
charts.forEach((sdk, i) => {
  sdk.renderLineChart(data[i], { axes: { x: { type: 'time' } } });
  sdk.enableNodeInteractions(canvases[i], { autoRender: true });
  sdk.render();
});

const disconnect = Charturbo.connect(charts, { cursor: true, x: true }); // 两者默认均为 true
// 之后
disconnect();
```

## 按键名分组

除数组外，图表也可以加入具名分组（与 ECharts `group`、Highcharts 同步图表的方式相同）：

```ts
const a = await Charturbo.create(canvasA, { sync: { key: 'dash', tooltip: true } });
const b = await Charturbo.create(canvasB);
b.setSync({ key: 'dash' });   // 稍后加入；setSync(null) 退出
b.getSync();                  // { key: 'dash', cursor, x, tooltip } | null

const disband = Charturbo.connect('dash', { x: false }); // 分组通用选项
disband(); // 所有成员退出该分组
```

- `Charturbo.connect(array, options)` 创建新分组；返回的函数断开这些图表的联动。
- `Charturbo.connect(key, options)` 为所有加入 `key` 的图表设置选项；成员自身的选项优先。返回的函数解散该分组。
- 加入一个分组会退出之前的分组。`dispose()` 也会退出分组。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `key` | `string` | — | 分组名称（`create({ sync })`、`setSync`） |
| `cursor` | `boolean` | `true` | 共享悬停：其他图表在悬停的数据 x 处显示十字准线和标记 |
| `x` | `boolean` | `true` | 以数据单位共享 x 缩放 / 平移 |
| `tooltip` | `boolean` | `false` | 跟随的图表也在联动的 x 处显示提示框 |
| `y` | `false` | — | 从不共享 y 范围 |

## 工作原理

- **光标**：被悬停的图表报告其数据 x（折线图：系列 `x` / epoch ms 或样本索引；柱状图：类目索引；散点图：x）。其他图表以 index 模式对该 x 进行命中测试，并绘制十字准线和每个系列最近的标记。柱状图高亮 `round(x)` 处的类目；散点图不绘制十字准线，只标记每个系列最近的点。超出某图表范围的 x 会清除该图表的悬停，指针离开时清除所有悬停。
- **缩放 / 平移**：一个图表的 `'rangechange'` 会以数据单位调用其他图表的 `setXRange`；每个引擎将范围限制在自身值域内。
- 联动产生的回声会被忽略，因此不会形成反馈循环。更新按分组在每个动画帧内合并应用一次，并且只重新渲染发生变化的图表。
- 被悬停的图表需要 `enableNodeInteractions`。

::: tip 提示
联动的位置使用数据单位。同一分组中的图表应使用相同的 x 单位：全部为时间轴的 epoch ms，或全部为样本 / 类目索引。
:::

## 手动光标

```ts
sdk.hoverAtX(Date.parse('2026-01-01T09:00Z')); // 在数据 x 处悬停，不触发 'hover'
sdk.getHoverX();                               // 当前悬停的数据 x，或 null
sdk.hoverAtX(null);                            // 清除
sdk.render();
```

`hoverAtX(x, { tooltip: true })` 同时显示内置提示框。可用于通过应用自身的控件（例如时间滑块）驱动图表。

## React 与 Vue

组件接受 `syncGroup` prop：键名字符串或完整的成员选项。

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={cpuSeries} syncGroup="dash" />
<CharturboChart type="line" data={memSeries} syncGroup={{ key: 'dash', tooltip: true }} />
```

```vue
<script setup lang="ts">
import { CharturboChart } from 'charturbo/vue';
</script>

<template>
  <CharturboChart type="line" :data="cpuSeries" sync-group="dash" />
</template>
```

## 另请参阅

- [交互](./interactions)：`rangechange`、`setXRange`
- [提示框与悬停](./tooltips)：`hoverAtX`、固定提示框
- [数据与坐标轴](./data-and-axes)：为什么小型多图通常优于双 y 轴
- [React](./react) · [Vue](./vue)
