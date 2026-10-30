# React

`charturbo/react` 提供 `<CharturboChart>` 组件和 `useCharturboChart` Hook。每个挂载的图表持有一个 `Charturbo` 引擎，仅在 props 的引用变化时重新渲染；props 未覆盖的功能可通过 ref 直接调用引擎。

[在线示例](https://jparkk0517.github.io/Charturbo/react.html)

## 安装

```sh
npm install charturbo react react-dom
```

`react` 和 `react-dom`（>= 18）是可选的 peer 依赖。核心入口（`charturbo`）不会 import React。`charturbo/react` 仅提供 ESM（无 CommonJS 构建）。

## 基本用法

```tsx
import { useMemo, useRef } from 'react';
import { CharturboChart, type CharturboChartHandle } from 'charturbo/react';

export function CpuChart({ values, dark }: { values: Float32Array; dark: boolean }) {
  const chart = useRef<CharturboChartHandle>(null);
  // data / options 按引用比较：用 useMemo 记忆化，只在变化时重新渲染
  const data = useMemo(() => [{ name: 'CPU', values }], [values]);
  const options = useMemo(() => ({ title: 'CPU 使用率', legend: false }), []);

  return (
    <>
      <button onClick={() => chart.current?.sdk?.downloadImage('cpu.png')}>保存 PNG</button>
      <CharturboChart
        ref={chart}
        type="line"
        data={data}
        options={options}
        theme={dark ? 'dark' : 'light'} // 变化时只调用 setTheme（不重新传数据）
        syncGroup="dash"                 // 与同一键的图表同步十字准线和缩放 / 平移
        style={{ height: 320 }}          // 外层尺寸 = 画布尺寸
        onRangeChange={(r) => console.log(r.xMin, r.xMax)}
        onError={(e) => console.error(e)} // 无 WebGPU / WebGL2（CharturboInitError）、数据错误等
      />
    </>
  );
}
```

## Props

| Prop | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `type` | `CharturboChartType` | 必填 | 图表类型，参见[图表类型](#图表类型)。 |
| `data` | `CharturboChartData<T>` | 必填 | 该类型的数据，类型随 `type` 确定。 |
| `options` | `CharturboChartOptions<T>` | — | 对应 `render*` 方法的选项。 |
| `theme` | `'dark' \| 'light' \| CharturboTheme \| CharturboThemeInput` | —（保持当前主题） | 变化时调用 `setTheme`。 |
| `syncGroup` | `string \| ChartSyncMemberOptions \| null` | —（不同步） | 联动组的键，或传给 `setSync` 的完整成员选项。 |
| `interactions` | `NodeInteractionOptions \| false` | SDK 默认值（提示框、缩放 / 平移） | `enableNodeInteractions` 的选项，并自动加上 `autoRender: true`。`false` = 静态图表。迷你图默认没有交互。 |
| `createOptions` | `CharturboCreateOptions` | — | `Charturbo.create` 的选项（`locale`、`autoResize`（默认 `true`）、`device`、`animation` 等）。仅在挂载时读取一次。 |
| `className` / `style` | `string` / `CSSProperties` | — | 外层 `<div>`（带 `position: relative`）。在这里设置图表尺寸。 |
| `canvasClassName` / `canvasStyle` | `string` / `CSSProperties` | — | 内部 `<canvas>`（默认样式：`display: block; width: 100%; height: 100%`）。 |
| `onReady`、`onError`、`on*` | 函数 | — | 参见[事件](#事件)。 |

## 图表类型

| `type` | SDK 方法 |
|---|---|
| `'line'`、`'area'`、`'band'` | `renderLineChart`、`renderAreaChart`、`renderBandChart` |
| `'errorBar'`、`'impulse'` | `renderErrorBarChart`、`renderImpulseChart` |
| `'bar'` | `data` 为数组时调用 `renderBarChart`；为 `{ categories, series }` 时调用 `renderGroupedBarChart` |
| `'scatter'`、`'histogram'`、`'heatmap'`、`'box'` | `renderScatterChart`、`renderHistogram`、`renderHeatmap`、`renderBoxPlot` |
| `'candlestick'`、`'ohlc'` | `renderCandlestickChart`、`renderOhlcChart` |
| `'pie'`、`'combo'`、`'radar'`、`'gauge'`、`'funnel'`、`'waterfall'` | `renderPieChart`、`renderComboChart`、`renderRadarChart`、`renderGauge`、`renderFunnelChart`、`renderWaterfallChart` |
| `'calendar'` | `renderCalendarHeatmap` |
| `'treemap'`、`'sunburst'`、`'sankey'` | `renderTreemap`、`renderSunburst`、`renderSankey` |
| `'chord'` | `renderChordChart` |
| `'polar'` | `renderPolarChart` |
| `'sparkline'` | `renderSparkline` |
| `'pointCloud3d'`、`'surface3d'` | `renderPointCloud3D`、`renderSurface3D` |

## 事件

| Prop | 负载 | 触发时机 |
|---|---|---|
| `onReady` | `Charturbo` | 引擎创建完成且首个图表已渲染。 |
| `onError` | `unknown` | `create` 失败（无 WebGPU / WebGL2 时为 `CharturboInitError`），或渲染时抛出异常（数据错误）。 |
| `onHover` | `CharturboEventMap['hover']` | 悬停目标变化。 |
| `onClick` | `CharturboEventMap['click']` | 无拖动的点击或轻触。 |
| `onSelect` | `CharturboEventMap['select']` | 刷选确定或清除。 |
| `onRangeChange` | `CharturboRange`（`xMin`、`xMax`、`yMin?`、`yMax?`） | 可见范围变化（缩放、平移、重置、`setXRange`）。 |
| `onLegendToggle` | `{ series, visible }` | 显示或隐藏了某个系列。 |
| `onThemeChange` | `CharturboTheme` | 主题变化。 |
| `onResize` | `{ width, height }` | 渲染目标尺寸变化（物理 px）。 |
| `onDrill` | `CharturboEventMap['drill']` | 矩形树图 / 旭日图下钻或上钻。 |

回调可以是内联函数：组件始终调用最新的回调，不会重新订阅。渲染错误不会抛出，而是传给 `onError`。

## 访问 SDK

ref 的类型为 `CharturboChartHandle`：

| 成员 | 类型 | 说明 |
|---|---|---|
| `sdk` | `Charturbo \| null` | 引擎；就绪前和卸载后为 `null`。 |
| `canvas` | `HTMLCanvasElement \| null` | 内部画布。 |
| `whenReady()` | `Promise<Charturbo \| null>` | 以引擎 resolve；先被卸载或 `create` 失败时为 `null`。 |

```tsx
chart.current?.sdk?.setXRange(0, 100);
const sdk = await chart.current?.whenReady();
await sdk?.downloadChartPDF('cpu.pdf');
```

props 未覆盖的功能（导出、`setXRange`、`resetChartZoom`、[实时数据流](./streaming)追加）通过 SDK 调用。只做一次初始化时，也可以用 `onReady={(sdk) => ...}` 代替 ref。

## 更新规则与记忆化

组件从不对 props 做深比较：

- `type`、`data`、`options`：其中任一**引用**变化时，调用一次 `render*` 重新渲染图表。父组件每次渲染都传入新对象或新数组（例如在 `options` 中内联书写的 `{ title: 'CPU' }`）会导致每次都重新渲染。请将这些值放在 `useMemo`、state 或模块常量中。
- 原地修改 typed array 不会被检测到，请传入新的数组或对象。高频更新时，通过 ref 调用 SDK 的数据流方法，而不是修改 `data`。
- `theme`：变化时只调用 `setTheme`，不重新传数据。`undefined` 保持当前主题。
- `syncGroup`：只有键或标志（`cursor`、`x`、`tooltip`）变化时才调用 `setSync`，因此可以使用内联对象。
- `interactions`：引用变化时重新绑定 `enableNodeInteractions`。传入对象时请记忆化。
- `createOptions`：仅在挂载时读取一次，之后的变化会被忽略。要应用新值请重新挂载（例如更换 `key`）。
- 引擎就绪前变化的 props，会在就绪后立即以最新值应用一次。

## `useCharturboChart` Hook

需要自行布局画布时使用 Hook。画布的父元素必须设置定位：标签、图例和提示框覆盖层会挂在那里。

```tsx
import { useCharturboChart } from 'charturbo/react';

function Revenue({ items }: { items: { label: string; value: number }[] }) {
  const { canvasRef, sdk, error } = useCharturboChart({ type: 'bar', data: items });
  return (
    <div style={{ position: 'relative', height: 240 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
```

Hook 接受与组件相同的 props（不含 `className` / `style` / `canvas*`），返回：

| 成员 | 类型 | 说明 |
|---|---|---|
| `canvasRef` | `RefObject<HTMLCanvasElement \| null>` | 绑定到 `<canvas>`。 |
| `sdk` | `Charturbo \| null` | 就绪后的引擎（是 state，变化时组件会重新渲染）。 |
| `error` | `unknown` | 最近一次 `create` / 渲染错误。 |
| `getSdk()` | `Charturbo \| null` | 不触发重新渲染即可获取当前引擎（在 `onReady` 内、`whenReady` 之后）。 |
| `whenReady()` | `Promise<Charturbo \| null>` | 与 handle 相同。在挂载 effect 运行前调用时返回 `null`。 |

## 尺寸

外层 `<div>` 带有 `position: relative`，覆盖层标签和图例挂在其上。通过 `className` 或 `style` 设置尺寸后，画布以 100% 填满，SDK 的 `autoResize` 通过 `ResizeObserver` 同步 backing store 尺寸。

## 生命周期

- 引擎在挂载时创建一次（`Charturbo.create`，异步），卸载时释放。
- 若在创建完成前卸载，到达的引擎会被立即释放，且不调用任何回调。
- React StrictMode 的挂载 → 卸载 → 挂载也只创建一个引擎：创建被推迟一个微任务，第一个绑定在开始前即被丢弃。

## SSR

- 在 Node 中 import `charturbo/react` 是安全的：import 时不访问 `window` / `document`。
- 引擎只在客户端 effect 中创建。服务端只渲染 `<div><canvas></canvas></div>` 标记。
- 入口没有 `'use client'` 指令。在 React Server Components 框架（例如 Next.js App Router）中，请在标注了 `'use client'` 的文件中渲染 `<CharturboChart>`。

## 另请参阅

- [Vue](./vue)
- [共享 GPU 设备](./shared-device)
- [仪表盘联动](./dashboard-sync)
- [交互](./interactions)
- [安装与打包工具](./installation)
