# 性能

Charturbo 把繁重的工作放在 WebAssembly 中完成，并把数据保留在 GPU 上，从而让缩放、平移和悬停保持在屏幕刷新率。本页说明速度从何而来、在大数据下如何保持，以及基准测试测量了什么。

[基准测试对比](https://jparkk0517.github.io/Charturbo/benchmarks.html)

## 为什么快

| 技术 | 适用对象 |
|---|---|
| 在 Rust 中按像素列做 M4 降采样（每列的首个、末个、最小值和最大值） | 折线图和面积图：一百万个样本缩减为几千条线段，尖峰得以保留 |
| 按像素列聚合 OHLC | 宽度小于 2 px 的 K 线 |
| GPU 实例化，点只上传一次 | 散点图 / 气泡图：缩放和平移只改变视图 |
| 数值网格作为一张 `R32Float` 纹理，配合 256 色查找表 | 最大 4096 × 4096 个单元格的热力图：只绘制一个四边形，更换色带无需重新上传 |
| 在 Rust 中完成命中检测、堆叠计算、刻度布局、层级与桑基图布局 | 悬停和布局的开销不留在 JavaScript 中 |
| 只上传变化的部分 | 数据流只上传降采样结果（1M 窗口每帧约 155 KB）；桑基图悬停和矩形树图图例高亮只修改 uniform，而不是几何数据 |
| 常驻 GPU 的图布局（`stepPhysicsAsync`，WebGPU） | 位置和速度保留在 GPU 缓冲区中；由 GPU 构建 Barnes-Hut 八叉树并完成积分 |
| DOM 只用于文本 | 标题、图例、坐标轴标签和提示框；刻度标签 DOM 只在刻度变化时重建 |

## 大数据技巧

### 传入类型化数组

数值使用 `Float32Array`，x 值和时间戳使用 `Float64Array`。普通数组也可以，但会先被转换。只有一个系列且以 `Float32Array`（以及可选的 `Float64Array` x）传入时，SDK 会直接把数组交给引擎，而不生成拼接副本；在基准测试中，这让 1000 万个样本的折线所占 WebAssembly 内存从 78 MB 降到 41 MB。

```ts
const values = new Float32Array(n);
const x = new Float64Array(n); // 时间轴使用 epoch ms
sdk.renderLineChart([{ name: '传感器', values, x }], { axes: { x: { type: 'time' } } });
sdk.render();
```

### 追加数据，而不是重新渲染

`appendSeriesData` 向现有系列追加样本，`maxPoints` 维持一个滑动窗口。裁剪的均摊复杂度为 O(追加的样本数)，下一帧只对可见范围重新降采样。堆叠面积图使用 `appendAreaData` 完成同样的事情。每次更新都用完整数据调用 `renderLineChart` 会重新复制全部数据。

```ts
sdk.appendSeriesData(0, chunk, chunkX, { maxPoints: 1_000_000 });
sdk.render();
```

### 只在有变化时渲染

没有空闲循环：`render()` 只绘制一帧。请在数据或视图变化后调用它，或在 `enableNodeInteractions` 中使用 `autoRender: true`。对于数据流，请合并更新，每个动画帧只渲染一次。

### 多个图表共享 GPU 设备

`Charturbo.create(canvas)` 会为每个画布请求适配器和设备并编译所有管线，而浏览器把 WebGL 上下文限制在 16 个左右。使用 `CharturboDevice` 时，100 个迷你图的创建和首次渲染在 WebGPU 上耗时 165 ms，在 WebGL2 上耗时 717 ms（无头 Chrome）。参见[共享 GPU 设备](./shared-device)。

### 了解限制

- 散点图没有点降采样：每个点都会被绘制。500 万个点时，缩放和平移受 GPU 限制，为 12–13 fps。
- 当图表的 staged 标记超过 50,000 个时（例如一百万个点的散点图），会跳过动画。
- 10 万个节点的图物理模拟在 CPU 上无法实时运行。请先用 `warmup()` 完成布局后只做渲染，或降低步进频率，或在 WebGPU 上使用 `stepPhysicsAsync`。
- 在 WebGL2 回退模式下，散点图、热力图和多系列图表的 WebAssembly 内存峰值高出 1.6–2.4 倍。

### 进行测量

`sdk.getRenderStats()` 返回 GPU 缓冲区和纹理字节数、上一帧上传的字节数、staged 标记数量以及 WebAssembly 内存大小（在没有计数器的后端上返回 `null`）。

## 基准测试摘要

使用 `web/bench/` 测试框架在一台机器上测量：Apple M1，无头 Chrome 156，960 × 540 画布，DPR 1，60 Hz。稳态为 3 秒的滚轮缩放和拖拽平移（柱状图为悬停扫描）。在其他机器和浏览器上数值会有所不同。

| 场景 | TTFF ms WebGPU / WebGL2 | 稳态帧 med / p95 / max ms | 丢失 vsync / 帧数 | 每帧工作 med ms | GPU MB |
|---|---|---|---|---|---|
| line-1m-1s | 16.7 / 16.6 | 16.7 / 16.7 / 16.7 | 0/180 | 1.7 | 0.7 |
| line-10m-1s | 91.8 / 92.3 | 16.7 / 16.7 / 33.3 | 4/176 | 2.9 | 0.7 |
| area-stacked-1m | 26.9 / 25.6 | 16.7 / 16.7 / 33.3 | 1/179 | 5.5 | 5.3 |
| scatter-1m | 46.1 / 46.9 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 32.7 |
| scatter-5m | 210 / 244 | 83.3 / 117 / 117 | 144/37 | 1.6 | 128.7 |
| bar-10k | 19.0 / 19.1 | 16.7 / 16.7 / 16.7 | 0/180 | 1.1 | 1.2 |
| heatmap-4096 | 92.9 / 96.4 | 16.7 / 16.7 / 16.7 | 0/180 | 1.3 | 64.7 |
| candle-1m | 33.2 / 33.3 | 16.7 / 16.7 / 16.7 | 0/180 | 1.6 | 0.7 |
| stream-1m | 15.9 / 16.2 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 0.7 |

TTFF 和帧时间按 16.7 ms 的 vsync 量化；16.7 表示“在一帧之内”。`stream-1m` 每帧向 1M 窗口追加 10k 个点。

图布局，3 秒稳态（2026-10-27，布局改为常驻 GPU 之前）：

| 节点 / 边 | CPU 物理 ms / FPS | 混合 GPU 物理 ms / FPS |
|---|---|---|
| 10k / 20k | 17.74 / 52.7 | 6.23 / 60.0 |
| 100k / 200k | 285.76 / 3.7 | 41.87 / 19.6 |

与其他库的对比（uPlot、ECharts、Chart.js、Plotly、ChartGPU、SciChart、Highcharts、three.js、deck.gl、cosmos.gl、3d-force-graph）、完整的测量方法和已知限制见[基准测试方法](../contributing/benchmarks)。自行运行：`cd web && npm run bench`。

## 另请参阅

- [实时数据流](./streaming)
- [共享 GPU 设备](./shared-device)
- [3D 网络图](../charts/graph-3d)
