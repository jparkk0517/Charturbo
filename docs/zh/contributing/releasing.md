# 发布流程

npm 包 `charturbo` 由 `web/` 构建（`web/package.json`，产物位于 `web/dist-lib/`）。
本页只定义流程。实际发布（`npm publish`、推送标签）由负责人手动执行。

## 1. 版本策略（0.x SemVer）

在 1.0.0 之前遵循 [SemVer](https://semver.org/lang/zh-CN/) 的 0.x 惯例。

| 变更 | 递增位置 | 示例 |
|---|---|---|
| 公共 API 的不兼容变更（删除或修改名称 · 签名 · 默认值 · 事件负载 · 导出类型；有意改变渲染结果、需要更新视觉基准图像的变更；缩小支持的浏览器 · Node · peer 范围） | **minor** | 0.1.x → 0.2.0 |
| 向后兼容的功能新增（新图表类型 · 选项 · 方法 · 导出类型） | **minor** | 0.1.x → 0.2.0 |
| 缺陷修复、性能改进、文档、不改变渲染结果的内部变更 | **patch** | 0.1.0 → 0.1.1 |

- 在 0.x 中，一个 minor 可以同时包含功能新增和破坏性变更。破坏性变更必须写在 CHANGELOG（韩文撰写）的
  `### 변경`（变更）/ `### 제거`（移除）条目中，**并附上迁移方法**。
- 公共 API = 从 `charturbo`、`charturbo/inline`、`charturbo/react`、`charturbo/vue`
  导出的值和类型（`web/src/index.ts`、`src/react/index.ts`、`src/vue/index.ts`）。`WasmCharturboEngineBackend` 的
  wasm 绑定（`snake_case`）和内部模块路径（`dist-lib/sdk/*`）不属于公共 API。
- 计划废弃的 API 用 JSDoc `@deprecated` 标记，至少保留一个 minor 后再删除。
- npm 默认的 `^0.1.0`（= `>=0.1.0 <0.2.0`）范围在 0.x 中只接收 patch，因此用户在升级 minor 时查看 CHANGELOG 即可。
- 当 API 稳定（至少连续两个 minor 没有破坏性变更）且支持矩阵确定后，发布 1.0.0。
- 预发布版本使用 `0.2.0-rc.1` 格式，并通过 `npm publish --tag next` 发布（不改变 `latest` 标签）。

## 2. 发布检查清单

把每一步的结果附在发布 PR 中。任何一步失败都要中止。

### 准备
- [ ] 填写 `web/package.json` 中的 `TODO` 占位符（author · homepage · repository · bugs）以及 `LICENSE` 中的版权所有者
      （只要还有残留，`prepublishOnly` 中的 `scripts/check-release-metadata.mjs` 就会阻止 `npm publish`）。
- [ ] 确认 `main` 干净且为最新（`git status`、`git pull`）。
- [ ] 确定版本（见上表）后更新 `web/package.json` 中的 `version`。
- [ ] `web/CHANGELOG.md`：把 `[Unreleased]` 的内容移到新版本小节，并更新日期 · 对比链接。
- [ ] 确认 WASM 是用最新的 Rust 源码构建的：
      `wasm-pack build crates/charturbo-core --release --target web --out-dir ../../web/src/wasm-pkg`
      以及 `wasm-pack build crates/charturbo-core --release --target web --out-dir ../../web/src/wasm-pkg-webgpu --no-default-features`。
      生成的文件属于构建产物，打包需要默认与仅 WebGPU 两个 WASM 构建。

### 测试
- [ ] Rust：`cargo test -p charturbo-core`、`cargo clippy -p charturbo-core`（没有新警告）。
- [ ] 类型 · 单元：`cd web && npx tsc --noEmit && npx vitest run`。
- [ ] 视觉回归：`npm run test:visual`（WebGPU + WebGL2，基准图像无变化。
      如果是有意的变更，用 `-- --update` 更新并递增 minor）。详见[开发环境](./development)。
- [ ] 基准测试：用 `npm run bench`（[基准测试方法](./benchmarks)）确认 FPS ·
      首帧时间（TTFF）相比上一个版本没有变差 10% 以上，并把数据记录在 PR 中。
- [ ] 示例站点：`npm run examples:build` 后确认所有页面渲染时没有控制台错误
      （`npm run examples:preview`）。
- [ ] API 文档：确认 `npm run docs` 无警告地生成 `docs/public/api/`。
- [ ] 文档站点：确认 `cd docs && npm run check && npm run build` 通过。

### 检查包
- [ ] `npm pack --dry-run`（`prepack` 会构建默认与仅 WebGPU 两个库）：确认包含的文件只有 `dist-lib/**`、`README.md`、`CHANGELOG.md`、
      `LICENSE`、`package.json`，且大小与上一个版本接近（当前压缩后约 4.1 MB）。
- [ ] 把 `npm pack` 生成的 tarball 用 `npm install ./charturbo-x.y.z.tgz` 安装到使用方项目中确认：
  - Vite 应用（dev + build）：`charturbo_core_bg.wasm` 作为资源输出，图表正常绘制。
  - webpack 5 应用：输出 `.wasm` 资源，图表正常渲染。
  - `charturbo/inline`（esbuild 等没有资源处理的打包工具），UMD `<script>` 标签。
  - Node ESM `import` / CJS `require` / React · Vue SSR `renderToString` 运行时不抛异常。
  - 类型检查：`moduleResolution` `bundler`、`node16`（ESM + `.cts`）、`nodenext`、`node10`。
- [ ] （可选）确认 `npx @arethetypeswrong/cli --pack` 的结果没有新问题。

### 发布（负责人，手动）
- [ ] 发布提交：`chore(release): vX.Y.Z`。
- [ ] 标签：`git tag -a vX.Y.Z -m "vX.Y.Z"` → `git push origin vX.Y.Z`。
- [ ] `cd web && npm publish`（预发布加 `--tag next`；`prepack` 会重新运行 `build:lib` 和 `build:lib:webgpu`）。
- [ ] 仓库的发布说明 = CHANGELOG 中对应的小节。
- [ ] 把示例站点（`web/examples-dist/`）和 API 文档（`docs/public/api/`）发布到静态托管。
- [ ] 发布后立即在新目录中用 `npm install charturbo@X.Y.Z` 做安装 · 导入冒烟测试。

## 3. 错误发布的处理

- 在 72 小时内且没有依赖它的包时可以执行 `npm unpublish charturbo@X.Y.Z`，但默认做法是
  `npm deprecate charturbo@X.Y.Z "<原因>, 请使用 X.Y.(Z+1)"`，然后发布修复用的 patch。
- 同一个版本号不能重复使用。

## 另请参阅
- [开发环境](./development)
- [更新日志与迁移](../guide/migration)
