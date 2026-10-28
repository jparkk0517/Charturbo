# 开发环境

介绍如何从源码构建 Charturbo，生成库包、API 文档、示例站点和文档站点，以及如何运行 GPU 视觉回归测试。

## 1. 编译 Rust WASM 包
```bash
wasm-pack build crates/charturbo-core --target web --out-dir ../../web/src/wasm-pkg
```

## 2. 构建纯 NPM 库（`dist-lib/`）
只把 SDK 包和 `.d.ts` 类型定义打包到 `web/dist-lib/`，完全不包含示例展示页和基准测试 UI。
输出：
- `charturbo.js`（ES）+ `charturbo_core_bg.wasm`（独立文件，通过 `new URL('./charturbo_core_bg.wasm', import.meta.url)` 加载 → Vite · webpack 5（已验证）以及 Rollup / Parcel 的资源插件会把它当作资源处理）
- `inline.js`（`charturbo/inline`，以 base64 内嵌 WASM —— 适用于 esbuild 等没有资源处理的环境），`charturbo.umd.cjs`（UMD，内嵌 WASM：`<script>` 标签 · CommonJS `require`）
- 框架入口 `react.js` · `vue.js`（导入核心 chunk，`react` / `vue` 为 external）
- 类型：`index.d.ts`（+ 供 CJS 使用的 `index.d.cts` / `inline.d.cts`），`react/` · `vue/` · `sdk/` 声明。`scripts/finalize-dts.mjs` 为相对路径补上 `.js` 扩展名，使类型在 `moduleResolution: node16 / nodenext` 下也能解析。
- 如需更改 WASM 的位置，请在第一次 `create()` 之前调用 `setWasmSource(url | Response | bytes | WebAssembly.Module)`。
```bash
cd web
npm run build:lib
```

## 3. 发布到 NPM
```bash
cd web
npm login
npm publish --access public
```
发布前运行 `npm pack --dry-run`，可以确认包中只包含 `dist-lib/*`、`README.md`、`CHANGELOG.md` 和 `LICENSE`。`prepack` 会重新运行 `build:lib`。版本策略和完整检查清单见[发布流程](./releasing)，变更历史见 [`web/CHANGELOG.md`](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md)。

## API 文档 · 示例站点
```bash
cd web
npm run docs            # TypeDoc → docs/public/api/（src/index.ts、react、vue 入口）
npm run examples:dev    # 示例站点开发服务器（web/examples/，按图表类型分页 + 源码）
npm run site:dev        # 整个站点 http://localhost:5310/：示例 + /docs/ 下的本文档（在手机上查看请加 `-- --host`）
npm run examples:build  # 静态构建 → web/examples-dist/
```

## 文档站点
本文档站点是位于 `docs/` 的 [VitePress](https://vitepress.dev/) 项目。英文放在 `docs/`，韩文放在 `docs/ko/`，简体中文放在 `docs/zh/`，三者路径相同。
```bash
cd docs
npm install
npm run dev             # VitePress 开发服务器，仅文档（http://localhost:5173/docs/）
npm run build           # 静态构建 → docs/.vitepress/dist/
npm run preview         # 预览构建结果
npm run check           # 语言对应检查：每个页面都必须同时存在于 en / ko / zh
```
- `npm run check`（`docs/scripts/check-docs.mjs`）汇总 `docs/.vitepress/config.mts` 中的侧边栏以及 `guide/`、`charts/`、`contributing/` 下的页面；只要有页面在三种语言中的任意一种里缺失，或不在侧边栏中，就以 exit 1 失败。
- 新增页面时，先在 `config.mts` 的侧边栏表中加入 slug 和各语言标题，再创建三种语言的文件。
- API 参考（英文）：`cd web && npm run docs` 把 TypeDoc 输出写入 `docs/public/api/`，站点在 `/api/` 下原样提供。`docs/public/api/` 不纳入 git。

## 4. GPU 视觉回归测试（`npm run test:visual`）
在真实的无头 Chrome 中用 GPU 渲染测试用例图表，并把截图与基准图像比较。它与 `npm test`（vitest）是分开的脚本。
```bash
cd web
npm run test:visual                           # 比较（失败时 exit 1）
npm run test:visual -- --update               # 重写基准图像（在有意的渲染变更之后）
npm run test:visual -- --backend=webgpu --filter=pie   # 按后端 / 测试用例名称的一部分缩小范围
npm run test:visual -- --canvas-only          # 字体不同的机器：跳过包含 DOM 文本的 full 截图
npm run test:visual -- --repeat=3             # 在同一进程中重复 3 次（检查不稳定）
npm run test:visual -- --param=color:#ff00ff  # 测试用例参数（故意破坏以确认失败；不能与 --update 同时使用）
```
- 组成：`web/e2e/index.html` + `main.ts` + `fixtures.ts`（测试用例页面，由 Vite 提供），`run-visual.mjs`（运行器），`lib/image.mjs`（无依赖的 PNG 解码/编码 `node:zlib` + 像素 diff）。运行器在空闲端口上启动自己的 Vite 服务器，以独立的 `--user-data-dir` · `--remote-debugging-port` 启动 Chrome（`--headless=new --enable-unsafe-webgpu`，macOS 上加 `--use-angle=metal`），并通过 DevTools Protocol 为每个测试用例打开新页面。
- 后端：`webgpu` 轮次和强制 `webgl2` 轮次（页面在引擎启动前隐藏 `navigator.gpu`，使 wgpu 回退到 GL 后端 —— 与没有 WebGPU 的浏览器走同一路径）。实际后端通过 canvas 上下文确认，不一致则报错。
- 测试用例（27 个）：1M 点折线（M4 LOD）、折线深色/浅色主题、堆叠面积、分组柱状、散点、K 线、直方图（20 万样本）、热力图、箱线 · 小提琴、饼图 · 环形图、组合图、雷达 · 仪表盘 · 漏斗 · 瀑布、矩形树图 · 旭日图 · 桑基图、纵轴缩放（`line-yzoom`）· 框选缩放（`box-zoom`）、共享 `CharturboDevice` 上的 24 个迷你图网格、悬停（`hoverAtX` → 十字准线 + 标记）、导航器（缩放窗口）、刷选矩形（`selectChartRange` xy）。
- 两种截图：`canvas` = 用 `visibility: hidden` 隐藏 DOM 叠加层（标题 · 刻度 · 图例 · 色条 · 饼图标签）后只裁剪 canvas 区域（与字体无关，主要验证对象）；`full` = 包含标签的整个卡片（只在同一机器 · 同一字体下稳定 —— 在其他 OS / CI 上使用 `--canvas-only`）。
- 基准图像：`web/e2e/baselines/<webgpu|webgl2>/<fixture>.<canvas|full>.png`（108 个）。结果：`web/e2e/out/report.html`（基准 / 实际 / diff 并排）、`report.json`、`*.actual.png`、`*.diff.png`（`e2e/out/` 不纳入 git）。
- 比较：每个像素的 RGBA 通道最大差值超过阈值（canvas 24，full 32 / 255）即视为不同像素；不同像素比例超过 0.2% 或尺寸变化则失败。diff 图像：红 = 超过阈值，黄 = 阈值以内的差异，灰 = 相同。
- 确定性：固定种子 PRNG（mulberry32），固定 canvas 尺寸（480×300，迷你图 140×32），DPR 1（`deviceScaleFactor: 1`、`--force-device-scale-factor=1`），`--force-color-profile=srgb`，`autoResize: false`，区域设置 `en-US`，时间轴使用固定 UTC 日期，显式 padding（刻度标签宽度不会改变绘图区位置），模拟 `prefers-reduced-motion: reduce` / `prefers-color-scheme: light`。SDK 在此没有动画，所以执行一次 `render()` 并等待 3 帧后截图。在同一机器上连续运行 3 次，所有截图逐像素相同（diff 0）。
- 基准图像与 GPU · 驱动 · Chrome 版本绑定：在其他机器上失败时，先通过 report 查看差异，再在该机器上用 `--update` 重新生成。
- 找不到 Chrome（可用 `CHROME_PATH` / `--chrome=<path>` 指定，指定的路径不存在时同样 SKIPPED）或没有可用的 GPU 后端时，输出 `SKIPPED` 并 exit 0，带 `--strict` 时 exit 1。只跳过不可用的那个后端，其余照常运行（带 `--strict` 时缺少任一后端即失败）。测试框架自身的错误（没有匹配测试用例的 `--filter`、Chrome 连接断开等）exit 2。

## 另请参阅
- [发布流程](./releasing)
- [基准测试方法](./benchmarks)
