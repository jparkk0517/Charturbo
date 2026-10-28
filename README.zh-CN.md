# Charturbo

[English](README.md) · [한국어](README.ko.md) · **简体中文**

**基于 Rust + WebGPU 的大数据量 Web 图表库。** 以 60 FPS 缩放和平移 100 万至 1000 万个数据点。
不支持 WebGPU 的浏览器会自动切换到 WebGL2。

[![CI](https://github.com/jparkk0517/Charturbo/actions/workflows/ci.yml/badge.svg)](https://github.com/jparkk0517/Charturbo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[▶ 在线演示](https://jparkk0517.github.io/Charturbo/)** · [文档](https://jparkk0517.github.io/Charturbo/docs/zh/) · [基准测试](docs/zh/contributing/benchmarks.md) · [更新日志](web/CHANGELOG.md)

<p align="center">
  <a href="https://jparkk0517.github.io/Charturbo/"><img src="docs/assets/demo/hero.png" alt="折线图、散点图、K 线图、3D 网络图、桑基图和商业图表示例" width="880"></a>
</p>

## 为什么选择 Charturbo

- **大数据量下依然流畅**：数据降采样（M4）、命中检测、堆叠计算和刻度布局全部在 Rust（WebAssembly）中完成，并由 GPU 绘制。DOM 只负责标签、图例和提示框。
- **18 种图表**：折线图、面积图、柱状图、散点图、K 线图、直方图、热力图、箱线图/小提琴图、饼图、组合图、雷达图、仪表盘、漏斗图、瀑布图、矩形树图、旭日图、桑基图、迷你图
- **面向真实业务**：实时数据流、时间轴、对数轴、滚轮/拖拽/双指缩放、范围导航器、框选、仪表盘联动、PNG/SVG/PDF 导出
- **无障碍与多语言**：每个图表都有自动摘要、数据表格和键盘导航。内置文本支持英语、韩语和简体中文
- **React 与 Vue 组件**，附带 TypeScript 类型
- **设计设置**：浅色/深色及自定义主题、系列颜色与调色板、字体、网格与提示框、柱形圆角与数据标签（[在线体验](https://jparkk0517.github.io/Charturbo/benchmarks.html)）
- **3D**：大规模网络图（Barnes-Hut 物理布局、最短路径、搜索）、高维嵌入向量的 3D 投影与相似度检索、带刚体物理的 3D 场景（[示例](https://jparkk0517.github.io/Charturbo/graph.html)）

## 性能

**[▶ 交互式性能对比 · 切换主题/颜色](https://jparkk0517.github.io/Charturbo/benchmarks.html)**

下列图表**由 Charturbo 渲染，并通过 `exportChartSVG()` 导出**。对比页面支持选择测试场景、查看提示框、切换 4 种主题、修改强调色、调色板、字体、圆角和数值标签，以及下载 SVG。

在相同的种子数据上，与 uPlot、ECharts、Chart.js、Plotly、ChartGPU、SciChart 和 Highcharts 进行对比。测量环境为单台 Apple M1，TTFF 不含初始化开销。ChartGPU 的散点图只沿 x 轴移动，因此其工作量与其他库不同。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-ttff-dark.svg">
  <img src="docs/assets/bench-ttff-light.svg" alt="用 Charturbo 绘制的首帧时间对比。折线 1M、10M，散点 1M，柱状 10k。失败和不支持的情况单独标注。" width="880">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-fps-dark.svg">
  <img src="docs/assets/bench-fps-light.svg" alt="用 Charturbo 绘制的缩放/平移及柱形悬停时的 FPS 对比。60 Hz 显示器，各项数值见对比页面的表格。" width="880">
</picture>

请**按工作条件**解读这些图表。Charturbo 在每个场景的 CPU 和 GPU 测量中，只展示 FPS 较高的一种模式，所有指标都来自同一次被选中的运行（FPS 相同时取物理时间较短的模式）。Charturbo 与 three.js 使用相同的 3D Barnes-Hut 力模型。这些图数据是用早期的混合 GPU 模式（GPU 计算斥力，CPU 负责积分和空间索引）测得的，物理时间包含 GPU 往返。deck.gl 只做无物理渲染，cosmos.gl 是 2D GPU 布局，3d-force-graph 使用另一种 d3-force-3d 力模型。请不要把它们的 FPS 解读为同一任务的综合排名。超时是该适配器和设置下的结果。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-graph-dark.svg">
  <img src="docs/assets/bench-graph-light.svg" alt="10k 和 100k 节点的 FPS、物理时间和首帧时间。Charturbo 取最高 FPS 模式，GPU 物理包含 GPU 往返，deck.gl 只渲染，cosmos.gl 为 2D，工作条件不同。" width="880">
</picture>

在 Apple M1 上，混合 GPU 物理在 10k 节点时达到 **60 FPS**，100k 节点时为 **19.6 FPS**（CPU：43.8 / 3.5 FPS）。现在的 `stepPhysicsAsync` 会让整个布局常驻 GPU，尚未重新测量。用法是先 `await sdk.stepPhysicsAsync(0.016)` 再 `sdk.render()`，拾取或导出前调用 `await sdk.syncPhysicsPositions()`；在 WebGL2 下回退到 CPU。同步的 `stepPhysics()` 走 CPU 路径。

测量方法、各库的设置、完整表格和局限性见[基准测试方法](docs/zh/contributing/benchmarks.md)。自行运行：`cd web && npm run bench`。

重新生成 README 图片：`cd web && npm run bench:charts`（需要 Chrome）。对比页面可在 `npm run examples:dev` 后打开 `/benchmarks.html` 运行。

## 安装

> 尚未发布到 npm。目前请[从源码构建](docs/zh/contributing/development.md)。

```bash
npm install charturbo
```

Vite、webpack 5 等打包工具会自动处理 wasm 文件。不使用打包工具（`<script>` 标签）或使用 esbuild 时，请参阅[安装与打包工具](docs/zh/guide/installation.md)。

## 快速开始

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

// 100 万个数据点的折线图
const values = Float32Array.from({ length: 1_000_000 }, (_, i) => Math.sin(i / 5000) * 40 + Math.random() * 4);
sdk.renderLineChart([{ name: '传感器 A', values }], { title: '实时遥测' });

// 提示框、滚轮缩放、拖拽平移
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

React：

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={series} options={{ title: '使用率' }} style={{ height: 300 }} />;
```

各类图表的示例和源码见[在线演示](https://jparkk0517.github.io/Charturbo/)。

## 浏览器支持

| 渲染器 | 浏览器 |
|---|---|
| WebGPU | Chrome · Edge 113+、Safari 26+ |
| WebGL2（自动回退） | 其他现代浏览器 |

## 文档

[文档网站](https://jparkk0517.github.io/Charturbo/docs/zh/)提供英语、韩语和简体中文版本。如需在仓库中直接阅读，请查看 [docs/zh/](docs/zh/)。

- [快速开始](docs/zh/guide/getting-started.md) · [安装与打包工具](docs/zh/guide/installation.md) · [核心概念](docs/zh/guide/core-concepts.md)
- [图表手册](docs/zh/charts/line.md)：各图表的选项、数据格式和交互
- [国际化](docs/zh/guide/i18n.md)：内置文本（无障碍、提示框、数据表格）支持英语、韩语和中文
- API 参考：`cd web && npm run docs`（TypeDoc → `docs/public/api/`，英文）
- [基准测试](docs/zh/contributing/benchmarks.md) · [开发 · 构建 · 测试](docs/zh/contributing/development.md) · [发布流程](docs/zh/contributing/releasing.md)

## 许可证

[MIT](LICENSE)
