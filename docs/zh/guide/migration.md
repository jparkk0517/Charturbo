# 更新日志与迁移

本页说明 Charturbo 的版本如何变化，并列出升级时需要处理的破坏性变更。完整的变更列表见 [CHANGELOG](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md)。

## 版本策略（0.x）

在 1.0.0 之前，Charturbo 遵循 [SemVer](https://semver.org/lang/zh-CN/) 的 0.x 约定：

| 变更 | 升级的版本位 | 示例 |
|---|---|---|
| 公共 API 的不兼容变更：重命名或移除名称、签名、默认值、事件负载或导出类型；有意的渲染变化；缩小浏览器 / Node / peer 支持范围 | **minor** | 0.1.x → 0.2.0 |
| 向后兼容的新增：新的图表类型、选项、方法或导出类型 | **minor** | 0.1.x → 0.2.0 |
| 缺陷修复、性能改进、文档、不改变渲染结果的内部变更 | **patch** | 0.1.0 → 0.1.1 |

- 一个 minor 版本可能同时包含新功能和破坏性变更。破坏性变更会连同迁移方法一起写入 CHANGELOG。
- npm 默认范围 `^0.1.0`（`>=0.1.0 <0.2.0`）只接收 patch 版本。升级 minor 版本前请阅读 CHANGELOG。
- 计划废弃的 API 会在 JSDoc 中标记 `@deprecated`，并至少保留一个 minor 版本后再移除。
- 公共 API 指 `charturbo`、`charturbo/inline`、`charturbo/react` 和 `charturbo/vue` 导出的内容。WebAssembly 绑定（`WasmCharturboEngineBackend` 的 `snake_case` 方法）和内部路径（`dist-lib/sdk/*`）不属于公共 API。
- 预发布版本使用 `0.2.0-rc.1` 这样的版本号和 npm 的 `next` 标签。

## 当前状态

0.1.0 是首个版本，尚未发布。以下变更位于未发布（Unreleased）部分；如果你曾从源码构建并使用过更早的快照，则需要关注。

## 破坏性变更

### 更名为 Charturbo

产品已更名。请替换旧名称：

| 之前 | 之后 |
|---|---|
| 包 `viz-engine-sdk` | `charturbo` |
| `viz-engine-sdk/inline`、`/react`、`/vue` | `charturbo/inline`、`charturbo/react`、`charturbo/vue` |
| `VizEngineSDK` | `Charturbo` |
| `VizDevice` | `CharturboDevice` |
| `VizInitError` | `CharturboInitError` |
| `VIZ_THEMES` | `CHARTURBO_THEMES` |
| 其他 `Viz*` 类型（`VizTheme`、`VizEventMap`、`VizCreateOptions` 等） | `Charturbo*`（`CharturboTheme`、`CharturboEventMap`、`CharturboCreateOptions` 等） |
| React / Vue 的 `VizChart`、`useVizChart` | `CharturboChart`、`useCharturboChart` |
| WebAssembly 文件 `viz_core_bg.wasm` | `charturbo_core_bg.wasm` |
| UMD 文件 `viz-engine-sdk.umd.cjs`，全局 `VizEngineSDK` | `charturbo.umd.cjs`，全局 `Charturbo` |
| CSS 类 `viz-sdk-*` | `charturbo-sdk-*` |
| 导出排除属性 `data-viz-export="false"` | `data-charturbo-export="false"` |

```ts
// 之前
import { VizEngineSDK } from 'viz-engine-sdk';
const sdk = await VizEngineSDK.create(canvas);

// 之后
import { Charturbo } from 'charturbo';
const sdk = await Charturbo.create(canvas);
```

同时请更新针对叠加层类名的样式表，以及包含 `.wasm` 文件名的 `setWasmSource` 路径或复制步骤。

### `stepPhysicsAsync` 在提交时 resolve

GPU 图步进现在把布局保留在 GPU 上。详见 CHANGELOG 的 Unreleased 部分。

| 之前 | 之后 |
|---|---|
| promise 在 GPU 结果读回并应用后才 resolve | 步进提交后 promise 即 resolve；CPU 上的位置副本落后一到两帧 |
| GPU 步进期间修改数据或力参数会导致该结果被拒绝 | CPU 端的编辑（`moveNode`、`pinNode`、样式、`loadDataset`、`stepPhysics`）按顺序生效 |

如果在步进后立即拾取节点、导出、读取节点详情或检查 `isSleeping()`，请先等待位置同步：

```ts
await sdk.stepPhysicsAsync(0.016);
await sdk.syncPhysicsPositions(); // 仅在需要最新位置时
const id = sdk.pickNodeAtNdc(x, y);
```

仍需等待每次 `stepPhysicsAsync` 完成后再开始下一次；重叠调用会抛出 `A physics step is already pending`。

### 内置文本和数字跟随区域设置

内置 UI 文本（无障碍摘要、数据表和 CSV 表头、默认提示框、图例 / 面包屑 / 色条标签、默认系列名称、PDF 标题）现在会根据区域设置显示为英语、韩语或简体中文。因此部分英文输出也发生了变化：

| 之前 | 之后 |
|---|---|
| 数字按 `en-US` 格式化 | 按图表区域设置格式化；未设置时先使用页面语言（`<html lang>`），再使用浏览器语言 |
| 散点图默认系列名称从 0 开始计数 | 从 1 开始计数（`Series 1`） |
| 组合图、折线图和柱状图数据点的 `getNodeDetails().metadata.description` 始终为韩语 | 跟随区域设置 |
| 箱线图百分位须线显示 `1th` 等部分英文措辞 | 改为 `1st`；修正了 OHLC 键盘帮助、数据表标题、饼图“其他”项提示框和组合图描述 |

如果希望无论页面语言如何都保持英文文本和 `en-US` 数字，请显式设置区域设置：

```ts
const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
```

比较摘要、CSV 表头或提示框文本的测试或快照可能需要更新基准。参见[国际化](./i18n)。

## 已废弃的选项

以下选项仍被接受，但不起作用或会映射到替代选项。修改相关代码时请移除它们：

| 选项 | 状态 |
|---|---|
| `LineSeriesDescriptor.zOffset` | 被忽略；系列深度由引擎布局 |
| `LineSeriesDescriptor.pointSize` | 请使用 `marker: { size }`（未提供 `marker` 时会映射到它） |
| `BarChartItemDescriptor.row`、`col` | 被忽略；3D 布局由引擎计算 |
| `ScatterChartData.z` | 被忽略；散点图为 2D |
| `ScatterChartOptions.viewMode` | 仅支持 `'2d'` |

## 另请参阅

- [CHANGELOG](https://github.com/jparkk0517/Charturbo/blob/main/web/CHANGELOG.md)
- [发布流程](../contributing/releasing)
- [安装与打包工具](./installation)
