# Vue

`charturbo/vue` 为 Vue 3 提供 `<CharturboChart>` 组件和 `useCharturboChart` 组合式函数。每个挂载的图表持有一个 `Charturbo` 引擎，仅在 prop 被替换时重新渲染（浅层 watch），并通过模板 ref 暴露引擎。

[在线示例](https://jparkk0517.github.io/Charturbo/vue.html)

## 安装

```sh
npm install charturbo vue
```

`vue`（>= 3.3）是可选的 peer 依赖。核心入口（`charturbo`）不会 import Vue。`charturbo/vue` 仅提供 ESM（无 CommonJS 构建）。

## 基本用法

```vue
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { CharturboChart, type CharturboChartInstance } from 'charturbo/vue';

const data = shallowRef([{ name: 'CPU', values: new Float32Array(10_000) }]);
const options = { title: 'CPU 使用率' }; // 使用常量：模板中的内联对象每次渲染都是新引用
const chart = ref<CharturboChartInstance | null>(null);

function update(values: Float32Array) {
  data.value = [{ name: 'CPU', values }]; // 替换数组才会重新渲染（浅层 watch）
}
</script>

<template>
  <button @click="chart?.sdk?.downloadChartSVG('cpu.svg')">保存 SVG</button>
  <CharturboChart
    ref="chart"
    type="line"
    :data="data"
    :options="options"
    theme="light"
    sync-group="dash"
    style="height: 320px"
    @range-change="(r) => console.log(r.xMin, r.xMax)"
    @error="(e) => console.error(e)"
  />
</template>
```

## Props

| Prop | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `type` | `CharturboChartType` | 必填 | 图表类型，取值与 [React](./react#图表类型) 相同。 |
| `data` | `CharturboChartData` | 必填 | 该类型的数据（typed array、描述对象数组、对象；无运行时类型检查）。 |
| `options` | `CharturboChartOptions` | — | 对应 `render*` 方法的选项。 |
| `theme` | `'dark' \| 'light' \| CharturboTheme \| CharturboThemeInput` | —（保持当前主题） | 变化时调用 `setTheme`。 |
| `sync-group` | `string \| ChartSyncMemberOptions \| null` | —（不同步） | 联动组的键，或传给 `setSync` 的完整成员选项。 |
| `interactions` | `NodeInteractionOptions \| false` | SDK 默认值（提示框、缩放 / 平移） | `enableNodeInteractions` 的选项，并自动加上 `autoRender: true`。`false` = 静态图表。迷你图默认没有交互。 |
| `create-options` | `CharturboCreateOptions` | — | `Charturbo.create` 的选项（`locale`、`autoResize`（默认 `true`）、`device`、`animation` 等）。仅在组件 setup 时读取一次。 |
| `canvas-class` | `string` | — | 内部 `<canvas>` 的 class。 |

`class` 和 `style` 会透传到外层 `<div>`（带 `position: relative`）。在这里设置图表尺寸。

## 事件

| 事件 | 负载 | 触发时机 |
|---|---|---|
| `@ready` | `Charturbo` | 引擎创建完成且首个图表已渲染。 |
| `@error` | `unknown` | `create` 失败（无 WebGPU / WebGL2 时为 `CharturboInitError`），或渲染时抛出异常（数据错误）。 |
| `@hover` | `CharturboEventMap['hover']` | 悬停目标变化。 |
| `@click` | `CharturboEventMap['click']` | 无拖动的点击或轻触。 |
| `@select` | `CharturboEventMap['select']` | 刷选确定或清除。 |
| `@range-change` | `CharturboRange`（`xMin`、`xMax`、`yMin?`、`yMax?`） | 可见范围变化（缩放、平移、重置、`setXRange`）。 |
| `@legend-toggle` | `{ series, visible }` | 显示或隐藏了某个系列。 |
| `@theme-change` | `CharturboTheme` | 主题变化。 |
| `@resize` | `{ width, height }` | 渲染目标尺寸变化（物理 px）。 |
| `@drill` | `CharturboEventMap['drill']` | 矩形树图 / 旭日图下钻或上钻。 |

渲染错误不会抛出，而是通过 `error` 事件发出。

## 访问 SDK

模板 ref 的类型为 `CharturboChartInstance`（暴露的 ref 已解包）：

| 成员 | 类型 | 说明 |
|---|---|---|
| `sdk` | `Charturbo \| null` | 引擎；就绪前和卸载后为 `null`。 |
| `error` | `unknown` | 最近一次 `create` / 渲染错误。 |
| `canvas` | `HTMLCanvasElement \| null` | 内部画布。 |
| `whenReady()` | `Promise<Charturbo \| null>` | 以引擎 resolve；先被卸载或 `create` 失败时为 `null`。 |

```ts
const chart = ref<CharturboChartInstance | null>(null);
chart.value?.sdk?.setXRange(0, 100);
const sdk = await chart.value?.whenReady();
```

props 未覆盖的功能（导出、`setXRange`、`resetChartZoom`、[实时数据流](./streaming)追加）通过 SDK 调用。

## 更新规则与响应式

watch 是浅层的：每个 prop 只按引用比较，从不深比较。

- `type`、`data`、`options`：其中任一被**替换**时，调用一次 `render*` 重新渲染图表（同一 tick 内多个变化也只调用一次）。
- 将 `data` 放在 `shallowRef` 中，并赋值新的数组或对象来更新。原地修改 `reactive` 数组或 typed array 不会被检测到。`shallowRef` 还能避免为大数据创建深层代理。
- 模板中的内联对象（`:options="{ title: 'CPU' }"`）在父组件每次渲染时都是新引用，会导致每次都重新渲染图表。请使用常量、`shallowRef` 或 `computed`。
- `theme`：变化时只调用 `setTheme`，不重新传数据。`undefined` 保持当前主题。
- `sync-group`：只有键或标志（`cursor`、`x`、`tooltip`）变化时才调用 `setSync`。
- `interactions`：引用变化时重新绑定 `enableNodeInteractions`。
- `create-options`：只读取一次，之后的变化会被忽略。要应用新值请重新挂载（例如更换 `key`）。
- 传给 SDK 之前会用 `toRaw` 解包。

## `useCharturboChart` 组合式函数

需要自行布局画布时使用组合式函数。将模板 ref 指向一个父元素已设置定位的 `<canvas>`；标签、图例和提示框覆盖层会挂在该父元素上。

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';
import { useCharturboChart } from 'charturbo/vue';

const canvas = shallowRef<HTMLCanvasElement | null>(null);
const items = shallowRef([{ label: 'A', value: 3 }, { label: 'B', value: 5 }]);
const { sdk, error, whenReady } = useCharturboChart(canvas, { type: 'bar', data: items });
</script>

<template>
  <div style="position: relative; height: 240px">
    <canvas ref="canvas" style="width: 100%; height: 100%" />
  </div>
</template>
```

`useCharturboChart(canvasRef, props)` 接受与组件相同的 props，可以是普通值、ref 或 getter（`MaybeRefOrGetter`），也接受 `on*` 回调（`onReady`、`onError`、`onHover`、`onRangeChange` 等）。返回：

| 成员 | 类型 | 说明 |
|---|---|---|
| `sdk` | `ShallowRef<Charturbo \| null>` | 就绪后的引擎。 |
| `error` | `ShallowRef<unknown>` | 最近一次 `create` / 渲染错误。 |
| `whenReady()` | `Promise<Charturbo \| null>` | 与组件实例相同。 |

## 生命周期

- 引擎在 `onMounted` 中创建一次（`Charturbo.create`，异步），在 `onBeforeUnmount` 中释放。
- 若在创建完成前卸载，到达的引擎会被立即释放，且不发出任何事件。

## SSR

- 在 Node 中 import `charturbo/vue` 是安全的：import 时不访问 `window` / `document`。
- 引擎只在 `onMounted` 中创建，而 `onMounted` 不会在服务端运行。服务端渲染的输出只有 `<div><canvas></canvas></div>` 标记。

## 另请参阅

- [React](./react)
- [共享 GPU 设备](./shared-device)
- [仪表盘联动](./dashboard-sync)
- [交互](./interactions)
- [安装与打包工具](./installation)
