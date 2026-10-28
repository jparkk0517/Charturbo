# 什么是 Charturbo？

Charturbo 是一个在 GPU 上绘制的 Web 图表库。数据处理在编译为 WebAssembly 的 Rust 中进行，渲染使用 WebGPU（不可用时自动回退到 WebGL2），DOM 只负责标题、图例、坐标轴标签和提示框等文本。它面向在一百万到一千万个数据点下仍需保持流畅交互的图表。

[在线示例](https://jparkk0517.github.io/Charturbo/gallery.html)

## 架构

| 层 | 运行位置 | 职责 |
|---|---|---|
| 引擎（`charturbo-core`） | Rust，编译为 WebAssembly | 按像素列的 M4 降采样、命中检测、堆叠计算、刻度布局、层级与桑基图布局、直方图分箱、箱线图统计、图物理模拟 |
| GPU 渲染器 | WebGPU，或经由同一 `wgpu` 管线的 WebGL2 | 线、填充、柱、实例化的点、热力图纹理、十字准线与悬停标记、3D 视图 |
| SDK（`Charturbo`） | TypeScript | 画布尺寸、输入处理、DOM 叠加层（标题、图例、坐标轴标签、提示框）、无障碍、导出、事件 |

一个图表经过三个步骤：

1. `render*` 调用（例如 `renderLineChart`）校验输入，并以类型化数组的形式交给引擎。
2. 引擎只把数据缩减到当前视图所需的量（折线图大约每个像素列一对最小值/最大值），并准备好 GPU 实例。
3. `render()` 绘制一帧并更新叠加层 DOM。

缩放和平移只对可见范围重新执行第 2 步，因此每帧的开销主要取决于画布尺寸，而不是数据量。

## WebGPU 与 WebGL2

如果浏览器提供 WebGPU 适配器，`Charturbo.create(canvas)` 会在 WebGPU 上启动引擎；否则同一引擎在 WebGL2 上运行。无需选择后端，API 和渲染结果相同。

| 渲染器 | 浏览器 |
|---|---|
| WebGPU | Chrome / Edge 113+，Safari 26+ |
| WebGL2（自动回退） | 其他现代浏览器 |

WebGL2 回退模式下的差异：

- 可选的 GPU 图物理步进（`stepPhysicsAsync`）改为在 CPU 上运行。
- 基准测试中，散点图、热力图和多系列图表的 WebAssembly 内存峰值高出 1.6–2.4 倍；帧时间与 WebGPU 基本相同。
- 浏览器会限制同时存在的 WebGL 上下文数量（16 个左右）。图表较多的页面应共享一个设备，参见[共享 GPU 设备](./shared-device)。

另外还打包了一个去掉 WebGL2 栈的仅 WebGPU 构建，参见[安装与打包工具](./installation#webgpu-only-build)。

## 图表目录

| 分组 | 图表 |
|---|---|
| 直角坐标系 | [折线图](../charts/line)、[面积图](../charts/area)、[带状图 · 范围图](../charts/band)、[误差棒 · 脉冲图](../charts/errorbar-impulse)、[柱状图](../charts/bar)、[直方图](../charts/histogram)、[散点图 · 气泡图](../charts/scatter)、[K 线图 · OHLC](../charts/candlestick)、[热力图](../charts/heatmap)、[箱线图 · 小提琴图](../charts/box-violin)、[组合图](../charts/combo) |
| 商业图表 | [饼图 · 环形图](../charts/pie)、[雷达图](../charts/radar)、[仪表盘](../charts/gauge)、[漏斗图](../charts/funnel)、[瀑布图](../charts/waterfall)、[迷你图](../charts/sparkline) |
| 层级与流向 | [矩形树图 · 旭日图](../charts/treemap-sunburst)、[桑基图](../charts/sankey) |
| 3D | [PointCloud3D · Surface3D](../charts/scientific-3d)、[3D 网络图](../charts/graph-3d)、[嵌入向量 · 相似度](../charts/embeddings)、[3D 场景 · 物理](../charts/scene-3d) |

图表通用功能：实时数据流，时间轴 / 对数轴 / 反向轴 / 双 y 轴，滚轮 / 拖拽 / 双指缩放，范围导航器，刷选，仪表盘联动，标注，PNG / SVG / PDF 导出，可选动画，带数据表和键盘导航的无障碍摘要，以及 [React](./react) / [Vue](./vue) 组件。

## 适用场景

- 数据量大或变化快：数百万个样本的时间序列、最多数百万个点的散点图、传感器或行情数据流。
- 包含大量联动图表的仪表盘（光标与缩放联动，为数百个迷你图共享 GPU 设备）。
- 数万个节点的网络图和嵌入向量视图。

## 不适用的场景

- 在服务器端渲染图表图片。在 Node 中导入是安全的，但引擎只能在浏览器中创建，没有服务器端渲染器。
- 下载体积比速度更重要的小页面。默认 WebAssembly 模块原始大小约 2.6 MB，gzip 后约 1.0 MB。
- 既没有 WebGPU 也没有 WebGL2 的环境。此时 `Charturbo.create` 会 reject；请先用 `Charturbo.isSupported()` 检查并显示自己的替代内容。
- 现在就需要稳定 1.x API 的项目。Charturbo 处于 0.x 阶段，minor 版本可能包含破坏性变更（参见[更新日志与迁移](./migration)）。该包尚未发布到 npm（参见[安装](./installation)）。

## 另请参阅

- [快速开始](./getting-started)
- [核心概念](./core-concepts)
- [性能](./performance)
