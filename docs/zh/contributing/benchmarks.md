# 基准测试方法

本页汇总用 `web/bench/` 测试框架测得的 charturbo（Rust + WebGPU/WebAssembly）性能数据和测量方法，以及与 uPlot · ECharts · Chart.js · Plotly · ChartGPU · SciChart · Highcharts 的图表对比、与 three.js · deck.gl · cosmos.gl · 3d-force-graph 的 3D 图对比结果。数据来自下文所述的一台机器，**在其他机器 · 浏览器 · 显示器上会有所不同。** 可以用相同的命令自行复现。

- 最新原始结果：[`docs/bench/results.json`](https://github.com/jparkk0517/Charturbo/blob/main/docs/bench/results.json)、[`results.md`](https://github.com/jparkk0517/Charturbo/blob/main/docs/bench/results.md)。下文第 4~6 节的数据表是 **2026-10-26 的初始测量记录**；之后新增的库和修正后的测量，请以原始结果和[在线对比页面](https://jparkk0517.github.io/Charturbo/benchmarks.html)为准。
- 引擎自身的场景保留 2026-10-26 的记录。跨库对比在修正适配器后以 5 次（+1 次预热）、3 秒稳态重新测量。每次运行的时间 · 版本 · 设置记录在各条目的 `measurement` 中，实际样本数记录在 `result.ttff.frame.n` 中。
- 产品名称为 **Charturbo**。原始测量和基准测试 CLI 中的 `viz`、`vizgpu` 分别是 Charturbo CPU 路径和混合 GPU 路径的原有标识符，为保持测量记录的关联而保留。

### 用我们自己的 SDK 绘制的结果与设计设置

对比页面 `web/examples/benchmarks.html` 读取 `results.json`，在共享的 `CharturboDevice` 上用 `Charturbo.renderBarChart()` 绘制横向条形。所有场景显示在同一页面上并提供跳转链接，每个场景附一个可折叠的数据表。主题跟随示例站点页头的主题选择（浅色 · 深色 · 午夜 · 纸张）。即使无法使用 GPU，原始数据表也会保留。

`npm run bench:charts` 在 Chrome 中运行同样的图表代码，并用 **SDK 的 `exportChartSVG()`** 生成 6 个浅色/深色 SVG。只合成外层标题和测量条件，柱条 · 坐标轴 · 标签都由 SDK 生成。GitHub README 中以静态图片显示，GitHub Pages 中以带提示框的真实 SDK 图表显示。

![用 Charturbo 绘制的首帧时间对比](../../assets/bench-ttff-light.svg)

![用 Charturbo 绘制的缩放 · 平移及柱状图悬停时的 FPS 对比](../../assets/bench-fps-light.svg)

![10k · 100k 节点的 FPS、物理时间与首帧时间对比](../../assets/bench-graph-light.svg)

```bash
cd web
npm run examples:dev           # /benchmarks.html
npm run bench:charts          # 需要 Chrome；可用 CHROME_PATH 指定可执行文件
npm run bench:charts -- bench/out/results.json --out=bench/out/report
npm run bench:report:check    # 检查场景 · 主题 · 样式 · SVG · 移动端浏览器
```

失败 · 不支持 · 未测量的条目不会被换成 0，而是显示名称和原因。之前的 SciChart TTFF（不含数据复制）、物理运行未经验证的旧 3d-force-graph 结果、cosmos v2 物理重复运行的结果都已从图中排除，并标记为需要重新测量。

在对比页面和 README 图表中，SDK 显示为 **一个 Charturbo 条目**。每个场景在 CPU（`viz`）和混合 GPU（`vizgpu`）的有效测量中选择 FPS 较高的模式；并列时选择物理时间较短的模式。TTFF · FPS · 物理时间和测量条件都取自所选的同一次运行。所选模式显示在表格 · 提示框 · SVG 中，完整的 CPU/GPU 记录保存在原始 JSON/Markdown 中。这是测量结果的显示规则，并不表示 SDK 运行时会自动选择模式。

## 1. 复现方法

```bash
cd web
npm install                  # 对比库是 devDependencies（不包含在库包中）
npm run bench                # 完整运行：5 次重复（+1 次预热）、3 秒稳态、所有场景 × WebGPU/WebGL2 + 库对比（约 11 分钟）
npm run bench -- --quick     # 冒烟：2 次、1 秒，排除 10M / 5M / 4096² 场景
npm run bench -- --filter=line-1m,scatter --backend=webgpu --no-compare
npm run bench -- --compare-only --libs=viz,uplot
npm run bench -- --shots     # 每个页面的截图（web/bench/out/shots/）—— 用于确认库确实绘制了内容
npm run bench -- --profile   # 每个页面的 CPU profile + self time 最高的函数
# 只对新增的图表库做冒烟测试
npm run bench -- --quick --no-ours --libs=chartgpu,scichart,highcharts --out=bench/out/smoke
# 只对新增的图库做冒烟测试
npm run bench -- --quick --no-ours --filter=graph-10k --libs=viz,deckgl,cosmos,forcegraph3d --out=bench/out/smoke
# 只重新测量 3D 图并合并（大数据每项最长 300 秒）
npm run bench -- --filter=graph --no-ours --merge=../docs/bench/results.json && npm run bench:charts
```

`--merge=<results.json>` 把本次运行的条目合并到已有文件中（相同场景 + 库/后端会被替换，其余条目和 `meta` 保留，本次运行条件追加到 `meta.partialRuns`）。`.md` 也会按合并后的结果重写。

运行器（`bench/run-bench.mjs`）在空闲端口上启动自己的 Vite 服务器（cross-origin isolated：可以使用 `measureUserAgentSpecificMemory`），以独立的 profile 启动无头 Chrome（`--headless=new --enable-unsafe-webgpu`，macOS 上 `--use-angle=metal`，`--js-flags=--expose-gc`），每个场景在 **新标签页** 中打开页面。找不到 Chrome 时输出 `SKIPPED`。如果一个页面在 300 秒内没有结束（即使主线程被阻塞），就连同最后报告的阶段记为 `FAILED: timeout`，然后继续下一个。

## 2. 测量环境

| 项目 | 值 |
|---|---|
| 机器 | Apple M1（8 核），RAM 16 GB，macOS 15.1（Darwin 24.1.0） |
| 浏览器 | Chrome 156.0.8078.48，无头（`--headless=new`） |
| WebGPU 适配器 | apple / metal-3 |
| WebGL2 渲染器 | ANGLE (Apple, ANGLE Metal Renderer: Apple M1) |
| 画布 | 960×540 CSS px，DPR 1（`deviceScaleFactor: 1`） |
| 帧间隔 | 60 Hz（空闲 rAF 间隔中位数 16.7 ms） |
| Node | v22.23.3 |
| 对比对象 | uPlot 1.6.32、ECharts 6.1.0、Chart.js 4.6.1、Plotly gl2d 4.1.2、ChartGPU 0.4.0、SciChart 6.0.14、Highcharts 13.1.1、deck.gl 9.3.11、cosmos.gl 3.5.1、3d-force-graph 1.80.1。three.js：初始记录 0.170.0 → 修正对比 0.186.1；参见各条目的 `measurement.version` |

## 3. 测量方法

### 数据
- 所有数据都由固定种子的 PRNG（mulberry32，`bench/data.ts`）生成 —— 与运行 · 库 · 机器无关，样本相同。生成时间不计入测量。
- 折线：随机游走（`line-<N>-<S>s` = 共 N 个样本，S 个系列）。散点：3 个高斯簇。柱状 10k，热力图 2048² / 4096²，OHLC K 线 1M，矩形树图叶子 100k，桑基图节点 10k。
- 流式（`stream-1m`）：在 1M 窗口（`maxPoints: 1_000_000`）中每帧 `appendSeriesData` 10k 个点。

### 阶段（每个场景新开标签页）
1. 创建引擎（`Charturbo.create`；对比对象为库导入 + 初始化）—— 单独记为 `initMs`。
2. **TTFF**：1 次预热后进行 5 次完整渲染。每次都先等待两次 rAF 对齐 vsync 边界再开始。
   - `渲染调用` = 同步渲染调用的时长（viz：`renderXxxChart()` + `render()`；uPlot/Chart.js：创建图表；ECharts：`setOption(notMerge)` → `finished`；Plotly：`newPlot` 完成 + 1 次 rAF）
   - `TTFF` = 调用开始 → 下一帧交给合成器的时刻（rAF 之后的 task）。它 **按 60 Hz vsync 量化**，因此小于 16.7 ms 的差异请用 `渲染调用` 列比较。
   - `pixels` = 渲染 + 1 px GPU 回读（直到 GPU 工作完成）—— 在 `results.json` 中。
3. **内存**：两次强制 GC 后的 `performance.memory.usedJSHeapSize`（JS 堆）、`measureUserAgentSpecificMemory`（UA 内存：JS + wasm 等整个页面）、引擎统计中的 wasm 内存大小，以及 GPU 缓冲区 · 纹理字节数（`Charturbo.getRenderStats()`）。
4. **稳态 3 秒**：在 rAF 循环中每帧施加输入并记录 rAF 间隔。`丢帧` = 超过 16.7 ms 而错过的 vsync 数 / 测量帧数，`工作` = 该帧用于输入处理 + 渲染的 JS+wasm 时间，`主线程 ms/帧` = CDP `Performance.getMetrics` 中 TaskDuration 的增量 / 帧数（包括延迟执行 · 布局）。
   - viz 场景：真实的 SDK 手势路径 —— 滚轮放大（35%）→ 拖拽平移（30%）→ 滚轮缩小（35%）。没有导航的图表（柱状图、矩形树图、桑基图）做悬停扫描，流式场景每帧追加。
   - 库对比：所有库都使用 **相同的基于时间的窗口计划**（全量 → 放大到 1% 窗口 → 平移 1% 窗口 → 缩小回全量），通过各自的范围 API 施加（viz `setXRange`/`setYRange`、uPlot `setScale`、ECharts `dataZoom` 动作、Chart.js `scales.min/max` + `update('none')`、Plotly `relayout`）。散点图同时作用于 x 和 y。
5. **悬停延迟**：在重置后的全量视图中，40 帧内每帧移动一次指针。`悬停同步` = 事件派发时间（就地做命中测试的处理函数），`间隔 p95` = 悬停期间的 rAF 间隔（包括推迟到定时器 / 下一帧的工作）。
6. 重复阶段和悬停阶段分别有 30 秒 / 10 秒的预算，因此在 10M 数据上较慢的库只测量最少 3 次。

### 库设置（公平性）
每个库都使用其文档中针对大数据的设置（`bench/others.ts`）。

| 库 | 设置 |
|---|---|
| viz | 与 `ours.ts` 相同的 SDK 调用，`lineWidth: 1`，散点 `pointRadius: 1.5, opacity: 0.6`，WebGPU。折线自动使用 M4 LOD（按像素列取 min/max） |
| uPlot | 类型化数组列，隐藏点（折线路径本身已按像素列折叠）。散点：`mode: 2` + 自定义矩形绘制器（uPlot 散点演示的做法 —— 内置 `paths.points()` 会生成一个包含 1M 个圆弧的 Path2D，截图确认 Chrome 中什么也画不出来） |
| ECharts | canvas 渲染器，`animation: false`，类型化数组数据，折线 `sampling: 'lttb'`，散点/柱状 `large: true`，`inside` dataZoom |
| Chart.js | `parsing: false`，`normalized: true`，`animation: false`，折线使用 decimation 插件（`min-max`），`pointRadius: 0`（折线）/ 1.5（散点）。`{x, y}` 对象数组只在测量前生成一次 |
| Plotly | `scattergl`（WebGL）trace，gl2d 包。没有柱状 trace，因此排除 bar-10k |
| ChartGPU | 仅 WebGPU，`createChart` + ECharts 风格选项，`animation: false`，类型化数组 `{ x, y }` 数据。折线：`type: 'line'`，`sampling: 'lttb'`。散点：`type: 'scatter'`，`symbolSize: 3`。柱状：类目轴 + `type: 'bar'`（无缩放，悬停扫描）。窗口移动用 `inside` dataZoom + `setZoomRange(start%, end%)` —— 参数是 [0, 100] 的百分比（把绝对 x 值换算为相对定义域的比例）。**缩放仅支持 x 轴**，因此散点计划中的 y 窗口不生效 |
| SciChart | WebAssembly + WebGL2/WebGPU。`SciChartSurface.configure({ wasmUrl, wasmNoSimdUrl })`，`UseCommunityLicense()`（水印）。折线：`FastLineRenderableSeries` + MinMax 重采样。散点：`XyScatterRenderableSeries`，显式 x/y 范围。折线/柱状 y 轴自动范围。柱状：`FastColumnRenderableSeries`。**每次测量渲染都包含 `dataSeries.clear()` + `appendRange()` 的 wasm 数据复制**，然后 `nextStateRender()` → `invalidateElement()` → await。初始化后用 `SciChartSurfaceBase.debugWasmWebGPU()` 确认后端 |
| Highcharts | ESM 构建（`highcharts/esm/highcharts.js`）+ 以副作用方式导入 Boost 模块（`highcharts/esm/modules/boost.js`）。数据为 `[x, y]` 元组数组（Boost 快速路径）。柱状用 `type: 'column'`。`boostThreshold: 5000`（超过 5k 个点时使用 GPU），`useGPUTranslations: true`，`usePreallocated: true`。窗口移动：`xAxis.setExtremes(lo, hi, redraw, false)`，散点图的 y 轴同样处理 |

- `渲染调用` 的范围因库而异：viz 复用引擎、只重新传入数据；uPlot / Chart.js 每次都销毁并重建图表；Plotly 是 `purge` + `newPlot`。引擎/库的初始化时间单独记录（`initMs`）。
- 所有库都使用相同的内边距（左 64 / 右 24 / 上 36 / 下 36 px）、1 px 线宽和相同的颜色。提示框保持各库默认的悬停行为开启。

## 4. 结果：charturbo 场景

稳态 / 丢帧 / 工作 / 悬停 / 内存均为 WebGPU 数值（WebGL2 的全部数据在 `results.md` 中 —— 两个后端的稳态几乎相同）。`GPU MB` = 已分配的 GPU 缓冲区 · 纹理容量，`上传/帧` = 稳态期间每帧图表数据上传量的平均值。

| 场景 | 交互 | TTFF ms WebGPU / WebGL2 | 渲染调用 ms | 稳态帧 med / p95 / max ms | 丢帧 | 每帧工作 med ms | 悬停同步 ms | JS 堆 MB | wasm MB WebGPU / WebGL2 | GPU MB | 上传/帧 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| line-100k-1s | wheel+drag | 16.8 / 16.6 | 3.9 | 16.7 / 16.7 / 16.7 | 0/180 | 1.4 | 0.6 | 8.7 | 3.1 / 4.1 | 0.7 | 150 KB |
| line-100k-10s | wheel+drag | 16.7 / 17.8 | 5.8 | 16.7 / 16.7 / 16.7 | 0/180 | 1.4 | 0.8 | 9.1 | 8.4 / 13.0 | 2.3 | 633 KB |
| line-1m-1s | wheel+drag | 16.7 / 16.6 | 10.5 | 16.7 / 16.7 / 16.7 | 0/180 | 1.7 | 0.6 | 12.1 | 6.5 / 7.6 | 0.7 | 265 KB |
| line-1m-10s | wheel+drag | 17.1 / 17.2 | 16.7 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 1.0 | 16.0 | 9.6 / 22.9 | 2.3 | 1.5 MB |
| line-10m-1s | wheel+drag | 91.8 / 92.3 | 91.4 | 16.7 / 16.7 / 33.3 | 4/176 | 2.9 | 0.5 | 46.5 | 40.8 / 42.3 | 0.7 | 300 KB |
| line-10m-10s | wheel+drag | 72.9 / 73.4 | 72.5 | 16.7 / 16.7 / 33.3 | 6/175 | 4.8 | 1.2 | 84.6 | 78.7 / 86.9 | 2.3 | 2.6 MB |
| scatter-1m | wheel+drag | 46.1 / 46.9 | 45.4 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 0.9 | 15.9 | 55.7 / 113.5 | 32.7 | 736 B |
| scatter-5m | wheel+drag | 210 / 244 | 209 | 83.3 / 117 / 117 | 144/37 | 1.6 | 1.3 | 46.4 | 269.2 / 555.8 | 128.7 | 702 B |
| area-stacked-1m | wheel+drag | 26.9 / 25.6 | 26.4 | 16.7 / 16.7 / 33.3 | 1/179 | 5.5 | 0.9 | 16.0 | 39.4 / 64.6 | 5.3 | 4.3 MB |
| bar-10k | hover-sweep | 19.0 / 19.1 | 18.5 | 16.7 / 16.7 / 16.7 | 0/180 | 1.1 | 1.2 | 11.4 | 3.6 / 5.0 | 1.2 | 469 KB |
| heatmap-2048 | wheel+drag | 27.3 / 30.5 | 26.7 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 0.7 | 24.3 | 33.9 / 66.4 | 16.7 | 136 B |
| heatmap-4096 | wheel+drag | 92.9 / 96.4 | 92.1 | 16.7 / 16.7 / 16.7 | 0/180 | 1.3 | 0.7 | 72.3 | 129.9 / 258.4 | 64.7 | 136 B |
| candle-1m | wheel+drag | 33.2 / 33.3 | 32.8 | 16.7 / 16.7 / 16.7 | 0/180 | 1.6 | 0.8 | 23.5 | 40.4 / 40.9 | 0.7 | 80 KB |
| stream-1m | stream | 15.9 / 16.2 | 13.4 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 0.7 | 12.1 | 29.1 / 29.7 | 0.7 | 155 KB |
| treemap-100k | hover-sweep | 32.7 / 28.1 | 32.1 | 16.7 / 16.7 / 16.7 | 0/180 | 0.7 | 0.7 | 19.3 | 15.6 / 17.6 | 1.2 | 192 B |
| sankey-10k | hover-sweep | 100 / 81.0 | 99.2 | 16.7 / 16.7 / 16.7 | 0/180 | 0.7 | 0.7 | 11.2 | 99.9 / 140.4 | 64.7 | 7.2 KB |

小结：
- **1M 以内的折线 · 面积 · K 线 · 柱状 · 热力图 · 矩形树图** 在缩放/平移/悬停期间保持 60 fps（丢帧 0~1）。每帧工作 1~6 ms。
- **折线 10M**：首帧 73~92 ms（把 10M 个 f32 复制到 wasm + 范围计算 + 首次 M4 LOD），缩放/平移时每帧工作 3~5 ms，3 秒内丢 4~6 帧。
- **流式**：在 1M 窗口中每帧追加 10k 的同时保持 60 fps（工作 3.2 ms/帧，上传的只是 LOD 结果，约 155 KB/帧）。
- **散点 5M** 在缩放/平移时为 12~13 fps（帧间隔中位数 67~83 ms），看起来是 **GPU 受限**：JS+wasm 工作为 1.6 ms/帧，但光栅化 5M 个点实例超出了一帧（没有点 LOD/密度聚合）。
- **桑基图 10k**：悬停高亮只重写 GPU 的填充高亮 uniform（48 B）以及进出高亮集合的节点 · 连线的顶点，因此悬停扫描期间上传量从 **每帧约 40 MB → 约 7 KB**，同步悬停处理从 **14.5 ms → 0.7 ms**（WebGPU / WebGL2 相同，画面与之前逐像素一致）。矩形树图的图例高亮也只修改同一个 uniform（旭日图悬停仍会重新细分弧段）。
- WebGL2 回退的 TTFF 和稳态与 WebGPU 几乎相同，但在散点 · 热力图 · 多系列场景中 wasm 内存峰值大 1.6~2.4 倍（推测是 GL 后端路径中额外的暂存复制；wasm 内存不会缩小，因此为峰值）。

## 5. 初始测量记录：库对比（2026-10-26，viz = WebGPU）

下面的表格和解读是最初 5 个库对比的记录。8 个库的 **最新完整对比** 请参见[自动生成的表格](https://github.com/jparkk0517/Charturbo/blob/main/docs/bench/results.md#cross-library-comparison)和 [SDK 对比页面](https://jparkk0517.github.io/Charturbo/benchmarks.html)。

### line-1m-1s

| 库 | 渲染器 | 渲染调用 ms | TTFF ms (p95) | 稳态帧 med / p95 / max ms | fps | 丢帧 | 主线程 ms/帧 | 悬停同步 ms / 间隔 p95 ms | JS 堆 MB | UA 内存 MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 13.3 | 15.9 (16.6) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.7 | 0.6 / 16.7 | 19.8 | 26.5 |
| uplot 1.6.32 | canvas2d | 13.3 | 15.5 (16.0) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.0 | 0.1 / 16.7 | 20.2 | 27.4 |
| echarts 6.1.0 | canvas2d | 22.4 | 22.8 (31.8) | 16.7 / 16.7 / 33.3 | 59.7 | 1/179 | 6.5 | 0.9 / 16.7 | 80.0 | 95.3 |
| chartjs 4.6.1 | canvas2d | 17.1 | 17.4 (20.3) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 4.0 | 0.1 / 16.7 | 57.3 | 63.5 |
| plotly 4.1.2 | webgl | 285 | 298 (367) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.5 | 0.1 / 4300 | 132.4 | 315.4 |

### line-10m-1s

| 库 | 渲染器 | 渲染调用 ms | TTFF ms (p95) | 稳态帧 med / p95 / max ms | fps | 丢帧 | 主线程 ms/帧 | 悬停同步 ms / 间隔 p95 ms | JS 堆 MB | UA 内存 MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 91.8 | 92.1 (92.6) | 16.7 / 16.7 / 33.3 | 58.7 | 4/176 | 7.0 | 0.6 / 16.7 | 122.8 | 129.5 |
| uplot 1.6.32 | canvas2d | 81.3 | 81.7 (84.2) | 16.7 / 33.3 / 83.3 | 52.8 | 22/160 | 9.4 | 0.1 / 16.7 | 123.2 | 130.4 |
| echarts 6.1.0 | canvas2d | 133 | 133 (142) | 33.3 / 83.3 / 183 | 30.8 | 88/92 | 32.6 | 0.9 / 16.7 | 526.3 | 541.6 |
| chartjs 4.6.1 | canvas2d | 114 | 114 (118) | 16.7 / 33.3 / 100.0 | 52.1 | 24/157 | 10.0 | 0.0 / 16.7 | 469.4 | 475.6 |
| plotly 4.1.2 | - | 失败：timeout after 300 s (page was in phase "steady") |  |  |  |  |  |  |  |  |

### scatter-1m

| 库 | 渲染器 | 渲染调用 ms | TTFF ms (p95) | 稳态帧 med / p95 / max ms | fps | 丢帧 | 主线程 ms/帧 | 悬停同步 ms / 间隔 p95 ms | JS 堆 MB | UA 内存 MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 42.8 | 43.3 (53.6) | 16.7 / 16.7 / 33.3 | 59.7 | 1/179 | 1.8 | 1.0 / 33.3 | 15.9 | 22.7 |
| uplot 1.6.32 | canvas2d | 317 | 319 (323) | 16.7 / 33.3 / 300 | 44.6 | 49/141 | 13.6 | 0.1 / 16.7 | 16.4 | 23.6 |
| echarts 6.1.0 | canvas2d | 1035 | 1050 (1117) | 133 / 150 / 150 | 7.8 | 161/23 | 134 | 0.4 / 16.7 | 91.8 | 109.1 |
| chartjs 4.6.1 | canvas2d | 662 | 665 (670) | 283 / 617 / 617 | 3.2 | 193/10 | 339 | 0.0 / 383 | 201.8 | 208.0 |
| plotly 4.1.2 | webgl | 303 | 316 (332) | 16.7 / 16.7 / 33.3 | 58.3 | 5/175 | 16.2 | 0.1 / 16.7 | 124.3 | 307.3 |

### bar-10k

| 库 | 渲染器 | 渲染调用 ms | TTFF ms (p95) | 稳态帧 med / p95 / max ms | fps | 丢帧 | 主线程 ms/帧 | 悬停同步 ms / 间隔 p95 ms | JS 堆 MB | UA 内存 MB |
|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 19.1 | 19.6 (21.2) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 2.1 | 1.7 / 16.7 | 11.5 | 18.2 |
| uplot 1.6.32 | canvas2d | 3.2 | 16.8 (18.6) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 1.2 | 0.1 / 16.7 | 9.2 | 16.4 |
| echarts 6.1.0 | canvas2d | 67.4 | 83.4 (83.8) | 16.7 / 16.7 / 16.7 | 60 | 0/180 | 3.4 | 1.6 / 16.7 | 31.9 | 49.2 |
| chartjs 4.6.1 | canvas2d | 49.1 | 50.5 (54.7) | 33.3 / 33.3 / 66.7 | 37.6 | 68/113 | 26.9 | 0.0 / 16.7 | 14.0 | 20.2 |
| plotly 4.1.2 | - | 失败：Error: unsupported: the plotly gl2d bundle has no bar trace |  |  |  |  |  |  |  |  |

### 解读 —— 领先与落后之处
- **散点 1M**：viz 最快。渲染调用 43 ms，对比 Plotly 303 ms · uPlot 317 ms · Chart.js 662 ms · ECharts 1035 ms；缩放/平移时 60 fps（丢 1 帧），对比 Plotly 58 fps、uPlot 45 fps、ECharts 8 fps、Chart.js 3 fps。内存也最小（UA 22.7 MB，对比 Plotly 307 MB）。
- **折线 10M**：viz 的缩放/平移最流畅（丢帧 4，对比 uPlot 22、Chart.js 24、ECharts 88；p95 帧 16.7 ms，对比 33~83 ms）。**但首次渲染 uPlot 更快**（81 ms 对 92 ms）。Plotly 在 10M 时缩放阶段未能在 300 秒内完成，记为失败（每次 `relayout` 都会全量重新处理）。
- **折线 1M**：viz 与 uPlot 基本持平（渲染调用同为 13.3 ms，都是 60 fps）。Chart.js（decimation）也是 60 fps，ECharts 渲染 22 ms、丢 1 帧。Plotly 首次渲染约 300 ms，悬停间隔 p95 为 4.3 秒（处理悬停时主线程停顿）。
- **柱状 10k**：**uPlot 领先** —— 渲染调用 3.2 ms 对 viz 19.1 ms（TTFF 16.8 对 19.6 ms），悬停同步 0.1 对 1.7 ms。两者都是 60 fps。viz 一侧的原因（柱状布局 · 坐标轴 · DOM 叠加层中的哪一个）尚未分析（可用 `--profile` 确认）。Chart.js 在悬停扫描时为 38 fps。
- **JS 堆**：折线 1M/10M 下 viz 与 uPlot 相近（大部分是输入的 Float32Array 本身）。ECharts / Chart.js 在 10M 时为 470~530 MB。
- viz 的 GPU 内存不计入 UA 内存（参见 `GPU MB` 列）。

## 6. 图测量方法与初始记录

`graph-10k`、`graph-100k` 场景（`bench/graph.ts`，`main.ts` 中的 `runGraph`）。下面的初始数据表 · 解读是 2026-10-26 的 viz/three.js 记录。按 CPU/GPU 区分的 6 个对比行的最新数据和失败原因，请参见[自动生成的表格](https://github.com/jparkk0517/Charturbo/blob/main/docs/bench/results.md#graph-10k)。

### 方法
- **数据**：演示应用的固定种子生成器（`GraphDatasetTS.generateSeeded`，xorshift，seed 42）—— N 个节点、2N 条边（80% 在同一簇内）、8 个簇、半径 100 的空间。生成不计入测量。两个引擎都通过 `loadRawDataset` 接收相同的 TypedArray 缓冲区。
- **引擎**：**原样** 使用演示对比页面所用的适配器（`src/adapters/rust-wgpu-adapter.ts`、`src/adapters/three-js-adapter.ts`，物理在 `src/three-engine/octree-physics.ts`）。没有针对基准测试做调优。额外的对比适配器只存在于 `bench/graph.ts` 中（实现 `EngineAdapter` 接口）。
  - viz：Rust Barnes-Hut（wasm，单线程）+ WebGPU，节点为球形公告板替身（一个四边形），边为线。
  - vizgpu：相同的 3D Barnes-Hut 模型 · 数据 · 渲染器。在 GPU 上计算斥力，并每步回读到 CPU 以更新弹簧 · 积分 · 空间索引的 **混合** 路径（`stepPhysicsAsync`）。并非 GPU 常驻模拟。
  - three.js：同一算法的 JS Barnes-Hut 八叉树 + `InstancedMesh`（8×6 分段球体，`MeshLambertMaterial`）节点 + `LineSegments` 边，WebGL2（ANGLE Metal）。
  - deck.gl：`ScatterplotLayer`（节点）+ `LineLayer`（边），`OrbitView`，WebGL2。**没有布局引擎** —— 节点固定在 `loadRawDataset` 的初始位置。`tick()` 只做重绘。测量的是纯 GPU 渲染开销。
  - cosmos.gl：WebGL2 GPU 力导向布局，**仅 2D**。丢弃输入坐标的 z，只使用 x · y。同时设置 `enableRenderLoop: false` 和 `pause()`，用 `step()` + `renderOneFrame()` 手动驱动帧。从 v3 起验证在只执行一次物理 · 有限的坐标移动 · 渲染时坐标保持不变。之前的 v2 在 `renderOneFrame()` 中也会运行物理，因此每帧执行两步。算法与 viz/three.js 的 3D Barnes-Hut 不同（GPU 斥力 + 弹簧，不属于 d3 系列）。
  - 3d-force-graph：d3-force-3d 布局（多体斥力使用 Barnes-Hut，力和积分方式与 viz 不同），three.js 0.186 + WebGL2。停止 RAF，用 scene 的 `ThreeForceGraph.tickFrame()` + `renderer().render()` 手动驱动。顶层公共 API 中没有 `tickFrame()`，因此会检查 scene 对象，找不到时测量失败。
- **相同条件（viz · three.js）**：力模型和常数（斥力 25、弹簧 0.08 / 静止长度 8、中心引力 0.03、阻尼 0.88、θ 0.75、softening 1.5、最大速度 60、八叉树最大深度 10），每帧固定 dt 0.016，相机（距离 220、yaw 0.4、pitch 0.3、fov 45），960×540 画布 @ DPR 1，关闭自动休眠。
- **deck.gl 条件**：通过 `loadRawDataset` 传入相同的初始位置数据并保持固定（无物理）。`OrbitView` 的 `rotationOrbit` 以度（°）为单位，zoom 初始值 1。没有相机距离的概念（以缩放级别代替）。
- **cosmos.gl 条件**：相同的初始 x · y 坐标（丢弃 z）。`spaceSize: 4096`、`simulationRepulsion: 1`、`simulationLinkSpring: 1`、`simulationGravity: 0.25`、`simulationDecay: 1000`、`simulationFriction: 0.85`。由于是 2D，没有相机旋转（`rotateCamera` 为 no-op）。
- **3d-force-graph 条件**：相同的节点 · 边数据，d3-force-3d 默认力（与 viz/three.js 的常数不同）。`cooldownTicks/Time: Infinity`、`d3AlphaMin: 0`、`warmupTicks: 0`，停止自动 RAF。数据加载会等到 `onFinishUpdate`，因此包含 scene 创建 · 首次渲染。在稳态开始前的一次验证步骤中确认 `onEngineTick` 被调用 1 次且节点确实移动，并记录到 `physicsValidation`。验证步骤不计入计时样本。相机初始距离 220、yaw 0.4、pitch 0.3。
- **阶段**：
  1. `初始化` = 创建引擎（viz 在此创建全部 GPU 管线）。`cold` = 在新引擎上首次加载数据 + 显示首帧（测量 1 次）。three.js 在首次渲染时编译着色器，这部分开销计入 `cold`，而 viz 计入 `初始化`。因此单独比较 cold 对 viz 有利，看 `初始化 + cold` 更公平（10k：47.6 对 123.8 ms，100k：86.5 对 124.3 ms；three.js 的初始化还包含模块的动态 import）。
  2. `TTFF` = 重新加载相同缓冲区（重置位置）+ 显示首帧，1 次预热后取 5 次的中位数。按 60 Hz 量化。
  3. 稳态 3 秒：每帧 `tick(0.016, true)`（一步 Barnes-Hut + 缓冲区同步 + 绘制），并按经过时间让相机绕轨道旋转（3 秒转半圈）。`物理` = 步进时间，`渲染` = 同步 + 绘制提交时间（GPU 执行是异步的，不包含在内 —— 反映在帧间隔中）。**fps 是基准指标。** 当帧工作略超过 16.7 ms 时，rAF 间隔会在 16.7 / 33.3 ms 之间交替，中位数可能显示为 16.7 ms（viz 10k）。
  4. 内存：稳态结束并强制 GC 后的 JS 堆、wasm 内存（viz）、UA 内存。

在稳态循环中，`vizgpu` **等待每个异步步骤完成后** 再渲染。其物理时间是包含快照生成 · 上传 · GPU 完成 · 回读 · CPU 弹簧/积分 · 索引重建在内的经过时间，与其他行的 CPU 执行/提交时间范围不同。GPU 计算管线在第一次物理调用时延迟创建，因此不包含在只做渲染的 init/cold/TTFF 中，而是在稳态开始前的验证步骤中支付这部分开销。`reps=5` 是 TTFF 的重复次数，稳态 FPS/物理时间来自一次 3 秒运行。

### 2026-10-27 改进：CPU 遍历 + 混合 GPU

相同的 Apple M1 / Chrome 156 / 60 Hz 环境，seed 42，3 秒稳态运行。前后两次运行是依次测量的，不是多轮重复合并的数据。

| 节点 / 边 | 改进前 CPU 物理 ms / FPS | 改进后 CPU 物理 ms / FPS | 混合 GPU 物理 ms / FPS |
|---|---|---|---|
| 10k / 20k | 21.48 / 43.8 | 17.74 / 52.7 | **6.23 / 60.0** |
| 100k / 200k | 310.30 / 3.5 | 285.76 / 3.7 | **41.87 / 19.6** |

- CPU 在重建时缓存质心，并用小型 DFS 记录和 escape 索引进行无栈遍历。回归测试确认遍历顺序 · 结果与之前相同。CPU 改进后单独运行的结果为 10k 17.71 ms / 52.4 FPS、100k 272.28 ms / 3.9 FPS。
- 混合物理相比改进前在 10k 时约快 **3.4 倍**，在 100k 时约快 **7.4 倍**。100k 的 FPS 约为 **5.6 倍**。CPU 树重建 · 积分、每步回读和渲染上传的开销仍然存在。
- 修正后的 cosmos（v3）在 10k 时为 60 FPS，100k 时为 55.4 FPS。它使用与 2D 不同的力近似 · 积分，因此不是同等质量的 3D 对比。cosmos 的物理提交时间（3.52 / 1.51 ms）不包含 GPU 执行，不能与混合路径的往返时间直接比较。
- 在真实 GPU/WASM 上与 CPU 对比：包括位于同一位置的重叠节点 · 固定节点，在 64 个/8 步（exact）、1k/16、10k/8、100k/3 时，最大坐标误差分别为 0、0.00000382、0.00000763、0.0000611。还验证了异步完成后的拾取、拒绝过期结果、并发调用、dispose、休眠、共享设备和 WebGL2 回退。
- 当前结果合并在 `bench/results.json` 中。前后原始文件为本地的 `web/bench/out/graph-before.json`、`graph-cpu-after.json`、`graph-after.json`。

::: warning 注意
上面的表格和说明是 **2026-10-27 混合路径**（GPU 斥力 + 每步回读后由 CPU 处理弹簧 · 积分 · 空间索引）的测量记录。此后 `stepPhysicsAsync()` 已改为 GPU 常驻布局：位置和速度保留在 GPU 缓冲区中，Barnes-Hut 八叉树构建 · 斥力 · 弹簧 · 积分 · 自动休眠都在 GPU 上执行。Promise 在提交时即完成，而不是在回读之后；GPU 工作期间的 CPU 编辑（`moveNode`、`pinNode`、样式、`loadDataset`、`stepPhysics`）不再被拒绝，而是按顺序应用。需要最新位置时（例如拾取 · 导出），请等待 `syncPhysicsPositions()`。当前行为请参见 [3D 网络图](../charts/graph-3d)。
:::

```ts
const gpuAvailable = sdk.supportsGpuPhysics();
await sdk.stepPhysicsAsync(0.016); // 提交时即完成；WebGL2 回退到 CPU
sdk.render();
await sdk.syncPhysicsPositions(); // 在拾取 · 导出之前把 CPU 副本更新到最新
```

`stepPhysics()` 仍然是 CPU 路径。请等待每个异步调用完成后再开始下一步（等待期间再次调用会抛出 `A physics step is already pending`）。超过 GPU 缓冲区/dispatch 限制时 Promise 会被拒绝（`Graph exceeds GPU layout buffer/dispatch limits`）。它不会自动渲染。默认的 full WASM 构建保留 WebGL2 回退，只有仅 WebGPU 构建使用 `--no-default-features`。

```bash
cd web
npm run wasm:build
npm run bench:physics:check
npm run bench -- --filter=graph --compare-only --libs=viz,vizgpu,cosmos --backend=webgpu --reps=5 --warmup=1 --duration=3000 --out=bench/out/graph-after
```

### graph-10k（10,000 个节点 · 20,000 条边）

| 引擎 | 渲染器 | 初始化 ms | cold ms | TTFF ms (p95) | fps | 稳态帧 med / p95 / max ms | 丢帧 | 物理 med (p95) ms | 渲染 med (p95) ms | JS 堆 MB | wasm MB | UA 内存 MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 30 | 17.6 | 16.7 (17.4) | **41.9** | 16.7 / 33.3 / 50.0 | 55/126 | **22.3** (23.1) | 1.0 (1.2) | 8.7 | 7.1 | 15.4 |
| three.js 0.170.0 | webgl2 | 87 | 36.8 | 16.8 (17.7) | 16.3 | 66.7 / 83.3 / 100 | 134/49 | 56.4 (81.4) | 0.9 (2.1) | 25.8 | - | 40.5 |

### graph-100k（100,000 个节点 · 200,000 条边）

| 引擎 | 渲染器 | 初始化 ms | cold ms | TTFF ms (p95) | fps | 稳态帧 med / p95 / max ms | 丢帧 | 物理 med (p95) ms | 渲染 med (p95) ms | JS 堆 MB | wasm MB | UA 内存 MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| viz 0.1.0 | webgpu | 23 | 63.5 | **23.5** (38.9) | **3.0** | 367 / 383 / 383 | 190/9 | **361** (381) | 5.9 (7.9) | 13.6 | 63.0 | 20.4 |
| three.js 0.170.0 | webgl2 | 37 | 87.3 | 54.5 (60.4) | 0.8 | 1833 / 1833 / 1833 | 218/2 | 1799 (1818) | 30.0 (30.7) | 114.2 | - | 128.8 |

### 解读
- 差异主要来自 **物理步进**：同样的 Barnes-Hut，Rust/wasm 在 10k 时比 JS 快 2.5 倍（22 对 56 ms），在 100k 时快 5 倍（361 对 1799 ms）。因此模拟 + 旋转期间 10k 的 fps 为 41.9 对 16.3。
- **在 100k 时两者都不是实时的。** 每帧都运行物理时 viz 也只有 3 fps（three.js 0.8 fps）。100k 的图应先用 `warmup()` 预先布局、之后只做渲染，或者每隔几帧才运行一次物理（本场景没有测量纯渲染的 fps；每帧渲染提交时间为 5.9 对 30 ms）。
- **首帧**：10k 时两者都在一帧之内（16.7 对 16.8 ms，受 vsync 量化影响基本持平）。100k 时为 23.5 对 54.5 ms，cold 为 63.5 对 87.3 ms。
- **内存**：three.js 一侧因为每个节点都保留一个 JS 对象的数据结构（`GraphDatasetTS`），在 100k 时 JS 堆为 114 MB。viz 为 JS 堆 13.6 MB + wasm 内存 63 MB（wasm 内存不会缩小，因此是包含重复加载的峰值）。两侧的 GPU 内存都不包含在上表中（viz 引擎统计的 GPU 缓冲区为 3.1 / 20.6 MB，three.js 没有字节计数器）。

### 公平性说明（three.js 一侧实现的已知劣势）
three.js 一侧原样使用了演示对比页面的实现。它遵循常见的 three.js 大规模图配置（`InstancedMesh` 节点 + `LineSegments` 边，相同的 Barnes-Hut），但有些部分仍有优化空间。
- 物理（`octree-physics.ts`）：节点以对象数组（AoS）保存，每个节点的 `computeRepulsion` 都会新建 `[fx, fy, fz]` 数组和遍历栈数组，八叉树单元也每步重新创建为对象（GC 压力）。改用扁平的 TypedArray + 复用的栈，JS 一侧的物理时间可能会减少。测量的是“同一算法的普通 JS 实现”，而不是优化过的 JS 实现。
- 渲染（`three-js-adapter.ts` `syncBuffers`）：即使颜色不变，每帧也会对所有节点重写 `setColorAt` 和边的颜色缓冲区（是 100k 时 30 ms 渲染时间的一部分）。
- 节点几何体不同：viz 是四边形替身，three.js 是 80 个三角形的球体网格（`SphereGeometry(1, 8, 6)`，Lambert 光照）。在 100k 时 three.js 向 GPU 发送更多三角形。这里帧时间由物理主导，因此影响较小，但只比较渲染时，`THREE.Points` + 精灵着色器是更接近的对比。
- 算法细节差异（对性能的影响可以忽略）：Rust 以 `damping^(dt·60)`（dt 0.016 时为 0.88^0.96）施加阻尼，JS 每步直接乘以 0.88。Rust 八叉树在最大深度处以链表保留重叠节点，JS 则丢弃。three.js 适配器的 `tick` 把 O(N) 的动能求和计入 `物理` 时间（100k 时约 1 ms）。
- 画面颜色不同（three.js 的 sRGB 输出转换和 Lambert 光照、背景色）。与性能无关。
- 同步的 viz 物理是 wasm 单线程（无 SIMD · 多线程）。只有可选的 `vizgpu` 使用 GPU 计算斥力。

## 7. 本次工作中的瓶颈修复（前 → 后）

前（before）= 本次修复之前的源码 + 只添加了统计计数器的构建，后（after）= 当前源码。在同一机器上交替运行 before/after 共 3 轮（WebGPU，5 次重复，稳态 2 秒），取各轮合并样本的中位数。每轮命令：`npm run bench -- --no-compare --backend=webgpu --filter=line-1m-1s,line-10m,area-stacked-1m,candle-1m,scatter-1m,stream-1m --reps=5 --duration=2000`。

| 场景 | 渲染调用 ms（前 → 后） | TTFF ms | 稳态工作 med ms | 稳态工作 p95 ms | 主线程 ms/帧 | 丢帧（3 次合计） | wasm MB |
|---|---|---|---|---|---|---|---|
| line-1m-1s | 21.5 → 13 (-40%) | 22 → 15.3 | 2 → 2 | 4.7 → 5 | 3 → 3 | 0 → 0 | 9.5 → 6.5 |
| line-10m-1s | 109 → 91.8 (-16%) | 109 → 92.2 | 5 → 4.8 | 19.3 → 20.4 | 8.5 → 8.5 | 9 → 11 | 78.1 → 40.8 |
| line-10m-10s | 125 → 74.8 (-40%) | 125 → 75.3 | 9.4 → 6.7 | 25.8 → 21.4 | 13.3 → 10.2 | 36 → 13 | 78.7 → 78.7 |
| scatter-1m | 46 → 39.9 (-13%) | 46.5 → 40.4 | 1.1 → 1 | 1.9 → 1.7 | 1.8 → 1.6 | 0 → 0 | 55.7 → 55.7 |
| area-stacked-1m | 36.3 → 26.5 (-27%) | 36.8 → 26.9 | 7.4 → 6.5 | 13.4 → 11 | 9 → 8.1 | 0 → 0 | 37.8 → 39.4 |
| candle-1m | 58.3 → 35 (-40%) | 58.7 → 35.4 | 3.2 → 2.9 | 13 → 7.7 | 5.6 → 4.3 | 1 → 0 | 40.4 → 40.4 |
| stream-1m | 22.8 → 13.6 (-40%) | 23.2 → 16.4 | 3.9 → 3.2 | 8.2 → 6.1 | 4.9 → 4.4 | 0 → 0 | 32.5 → 29.1 |

修改内容（结果全部相同 —— 用单元测试与原有实现对比）：
1. **不处理 NaN 的 min/max**（`chart/finite.rs`、`line.rs`、`candle.rs`、`scatter.rs`）：`f32::min`/`max` 因为要处理 NaN 操作数，在 wasm32 上每次比较都会退化为较慢的指令序列。对已经通过 `is_finite` 检查的值使用简单的比较-选择（快 2~3 倍）。
2. **折线范围计算单遍完成**（`line.rs` `extents`）：有限值 min/max 和正值 min/max（用于对数轴）从每个系列 2 遍改为 1 遍。
3. **M4 LOD 内层循环**（`line.rs` `push_m4`）：把当前的 min/max 值保存在寄存器中（之前每个样本都按索引重新读取），并列时保留第一个索引的规则不变。这是每个缩放/平移帧都要遍历所有可见样本的热循环。
4. **去掉单系列复制**（`charturbo.ts`、`lib.rs`）：单个系列 + `Float32Array`（以及 `Float64Array` x）直接传入，不再为拼接创建新数组；Rust 一侧直接持有 wasm-bindgen 已经复制好的 `Vec`，不再做第二次复制 → 10M 单系列的 wasm 内存 78 → 41 MB。
5. **无障碍摘要共享 O(n) 遍历**（`chart-a11y.ts` `withPassMemo`）：一次更新中摘要和描述原本各自计算相同的系列统计，现在只在该次更新范围内做记忆化（数据原地改变时，下一次更新会重新计算）。
6. **渲染统计 API**（`renderer/stats.rs`、`lib_stats.rs`、`chart-stats.ts`、`Charturbo.getRenderStats()`）：GPU 缓冲区/纹理字节数、每帧图表上传字节数、各图层的标记数、wasm 内存大小。用于基准测试和诊断（不改变渲染结果）。

未改善的部分：line-10m-1s 的稳态工作 p95 和丢帧数没有变化或处于噪声范围内（9 → 11）。10M 首次渲染剩余的时间主要是 JS → wasm 复制和首次 LOD。

## 8. 局限与注意事项
- 这是 **一台机器（Apple M1，无头 Chrome 156，60 Hz）** 的结果。无头 Chrome 的出帧方式可能与真实显示合成不同，在 120 Hz 显示器 · 其他 GPU · Windows/Linux · Firefox/Safari 上数值会有所不同。
- TTFF 和帧间隔按 vsync（16.7 ms）量化。小数据下的“16.7 ms”意思是“在一帧之内”，渲染调用列更精确。
- 不直接测量 GPU 执行时间（未使用时间戳查询）。`pixels`（1 px 回读）和帧间隔间接反映 GPU 受限的情况（例如 scatter-5m）。
- 使用合成输入（派发的 Pointer/Wheel 事件）和基于时间的计划。不测量真实用户输入延迟（输入 → 画面）。
- 库对比中 `渲染调用` 的范围不同（见上文第 3 节）。每个库都使用了文档中的大数据设置，但并未尝试所有调优（例如 uPlot 散点的 quadtree、调整 ECharts `progressive`、Chart.js 散点没有 decimation）。改进建议可以加到 `bench/others.ts` 中。
- Plotly line-10m 因 300 秒超时失败，bar-10k 因 gl2d 包中没有柱状图而被排除。
- 3D 图对比是整个引擎（数据结构 + 物理 + 渲染）的对比，并不是 three.js 本身渲染性能的对比；three.js 一侧实现的劣势写在第 6 节。graph-100k 中 three.js 的稳态 3 秒内只有 2 帧，因此 fps 0.8 是粗略值。
- 额外的图库 **与 viz/three.js 做的工作不同**：deck.gl 没有物理，只做渲染（`物理` 0 ms）；cosmos.gl 是 2D GPU 布局（丢弃 z，没有相机旋转）；3d-force-graph 使用 d3-force-3d（不同的力模型和常数）。不要直接比较 fps，请分开查看 `物理` / `渲染` 列。
- ChartGPU 仅支持 WebGPU，且缩放只支持 x 轴，因此缺少散点图的 y 窗口。SciChart 社区许可证会绘制水印，实际选择的后端记录在结果中。Highcharts 是商业许可证，Boost 阈值为 5,000。
- **测量更正**：之前 SciChart 约 33 ms 的 TTFF 只测量了初始化期间数据复制完成后的重绘。之前 3d-force-graph 约 55 FPS / 物理 0.01 ms 的结果，只是对已停止的模拟调用了 `d3ReheatSimulation()`。原先把这些解读为正确的数据加载 · 物理性能的说明是错误的。修正后的适配器记录 `methodologyVersion: 2`，并用重新测量的结果替换。
- 合并文件顶层的 `meta` 是第一次运行的环境。新的对比条目请查看各自的 `measurement`。输入旧记录时会标示条件混合 · 未验证的结果，不会假定统一为 5 次 · 3 秒。
- 内存：JS 堆是 GC 之后的值；wasm 内存不会缩小，因此是包含预热在内的峰值。GPU 字节数是 viz 引擎分配的容量，不包括驱动开销。
- 前/后对比的噪声：同一场景重复之间渲染调用的偏差约为 ±5%，丢帧为 ± 几帧。

## 另请参阅
- [开发环境](./development)
- [性能](../guide/performance)
- [3D 网络图](../charts/graph-3d)
