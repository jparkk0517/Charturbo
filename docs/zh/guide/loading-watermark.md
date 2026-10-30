# 加载提示与水印

[在线示例](https://jparkk0517.github.io/Charturbo/export.html)

## 加载提示

`showLoading` 用遮罩、加载图标和状态文本覆盖图表（ECharts `showLoading`）；`hideLoading` 将其移除。

```ts
sdk.showLoading();                                  // 图表语言的“加载中…”
const data = await fetchData();
sdk.renderLineChart(data);
sdk.render();
sdk.hideLoading();
```

**渲染不会隐藏加载提示。** 数据就绪后请调用 `hideLoading`。提示显示时再次调用 `showLoading` 只会更新选项。`isLoading()` 返回是否正在显示。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `text` | `'Loading…'`（en）、`'로딩 중…'`（ko）、`'加载中…'`（zh） | 状态文本 |
| `maskColor` | 主题表面色 80% | 覆盖图表的遮罩 |
| `color` | 调色板第一个颜色 | 加载图标颜色 |
| `textColor` | 主题主文本色 | 文本颜色 |
| `fontSize` | `12` | 文本字号（CSS px） |
| `spinner` | `true` | `false` 时只显示文本 |
| `delay` | `0` | 遮罩出现前的毫秒数，快速加载时不会闪烁 |

- **无障碍。** 图表容器立即获得 `aria-busy="true"`（隐藏时恢复原值）。文本通过 polite 实时区域播报。在 `prefers-reduced-motion` 下加载图标不旋转。
- **主题与语言。** 默认颜色跟随 `setTheme`，默认文本跟随 `setLocale`。
- **导出。** PNG、SVG 和 PDF 导出从不包含加载提示。
- **校验。** 错误的选项会抛出异常并保留当前提示。

## 水印

`setWatermark` 在图表上绘制文本或图片，位于绘图区之上、标签和提示框之下。传入 `null` 将其移除。

```ts
sdk.setWatermark({ text: 'CONFIDENTIAL' });                          // 平铺，旋转 30°
sdk.setWatermark({ text: 'DRAFT', fontSize: 64, repeat: false });   // 居中一个
sdk.setWatermark({ image: '/logo.png', imageWidth: 80, imageHeight: 24, opacity: 0.1 });
sdk.setWatermark(null);
```

| 选项 | 默认值 | 含义 |
|---|---|---|
| `text` / `image` | — | 二者必须且只能提供一个。`image` 为 URL，以 `crossOrigin = 'anonymous'` 加载 |
| `imageWidth`、`imageHeight` | `80`、`40` | 图片水印框（CSS px），图片保持宽高比放入框内 |
| `opacity` | `0.15` | 0..1 |
| `rotate` | `30` | 角度，正数为逆时针 |
| `fontSize`、`fontFamily`、`fontWeight` | `14`、主题字体、`'400'` | 文本字体 |
| `color` | 主题弱化文本色 | 文本颜色 |
| `gap` | `[80, 60]` | 水印间距（CSS px），数字或 `[x, y]` |
| `repeat` | `true` | 平铺整个图表，奇数行错开半个水印；`false` 时居中绘制一个 |
| `export` | `true` | 包含在 PNG、SVG 和 PDF 导出中 |

- **图表级别。** 渲染其他图表时水印仍然保留，并跟随主题切换。`getWatermark()` 返回填充默认值后的当前选项。
- **无障碍。** 该图层为 `aria-hidden`，并让点击穿透。
- **图片。** 无法加载（或没有 CORS 头）的图片不会绘制。没有 CORS 的跨源图片会阻止图片导出，因此会被跳过。SVG 导出通过 URL 引用图片（不嵌入），在其他位置打开的 SVG 请使用绝对 URL 或 data URL。
- **校验。** 错误的选项会抛出异常并保留当前水印。

## React 与 Vue

`CharturboChart` 以 prop 形式接收这两项：

```tsx
<CharturboChart type="bar" data={data} loading={isFetching} watermark={{ text: 'DRAFT' }} />
```

```vue
<CharturboChart type="bar" :data="data" :loading="{ text: 'Fetching…' }" :watermark="mark" />
```

`loading` 可以是 `true`、`showLoading` 选项，或用于隐藏的假值。`watermark` 为 `setWatermark` 选项，`null` 或缺省表示无水印。两者都按对象引用比较（在 React 中请对对象值进行记忆化）。
