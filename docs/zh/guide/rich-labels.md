# 富文本标签

与 ECharts `label.rich` 一样，一个标签可以混合多种字号、字重、颜色和小徽标。标签函数返回模板，`rich` 将样式名映射到文本样式。

[在线示例](https://jparkk0517.github.io/Charturbo/bar.html)

## 模板语法

```ts
'{value|42.5}{unit|k}\n{up|+12%}'
```

- `{name|text}` 使用 `rich[name]` 绘制 `text`；未知名称按普通文本绘制。
- `\n` 开始新的一行。
- `\{`、`\}` 和 `\\` 表示字面字符。
- 片段不能嵌套。没有 `name|` 前缀或没有闭合 `}` 的 `{` 是普通文本，因此 `{value}` 会原样显示。

## 支持的图表

| 图表 | 文本函数 | 上下文 |
|---|---|---|
| 柱状图 / 分组柱状图 | `labels.format` + `labels.rich` | `(value, { category, series, seriesName, categoryLabel, ... })` |
| 饼图 / 环形图 | `label.formatter` + `label.rich` | `{ name, value, percent, index, ring? }` |
| 矩形树图、旭日图 | `label.formatter` + `label.rich` | `{ name, value, depth }` |
| 桑基图 | `label.formatter` + `label.rich` | `{ name, value, column }` |
| 漏斗图 | `label.formatter` + `label.rich` | `{ stage, value, percentOfFirst, percentOfPrevious, index }` |

```ts
sdk.renderBarChart(items, {
  labels: {
    format: (v, c) => `{value|${v.toFixed(1)}}{unit|k}\n{badge|${growth[c.category]}%}`,
    rich: {
      value: { fontSize: 15, fontWeight: 'bold' },
      unit: { fontSize: 10, color: '#8a94a6' },
      badge: { color: '#fff', backgroundColor: '#1a9e5c', padding: [1, 5], borderRadius: 7, fontSize: 10 },
    },
  },
});

sdk.renderPieChart(data, {
  labels: 'outside',
  label: {
    formatter: (c) => `{name|${c.name}}\n{pct|${c.percent.toFixed(1)}%}`,
    rich: { name: { fontWeight: 600 }, pct: { fontSize: 13, color: '#3d7eff' } },
  },
});
```

## 样式选项

| 选项 | 含义 |
|---|---|
| `color` | 文本颜色 |
| `fontSize`、`fontWeight`、`fontStyle`、`fontFamily` | 片段字体 |
| `backgroundColor`、`padding`、`borderRadius` | 片段背后的方框。`padding` 为 `v`、`[纵向, 横向]` 或 `[上, 右, 下, 左]` |
| `lineHeight` | 片段的行框高度 |
| `align` | 片段所在行的对齐方式 `'left' \| 'center' \| 'right'` |

无样式的文本使用图表默认的标签字体和颜色。

## 布局与导出

- **布局使用测量后的文本。** 柱状图的内部容纳检测和 `'auto'` 重叠隐藏、饼图的引导线间距和侧边空间、漏斗图的标签空间都使用带样式文本行的尺寸。
- **矩形树图。** 单元标签会裁剪在单元内。标题条只显示模板的第一行。
- **导出。** PNG、SVG 和 PDF 导出按各片段自己的字体、颜色和方框绘制。
- **无障碍。** 屏幕阅读器获得不含样式名的纯文本。
- **安全的 DOM。** 文本只通过 `textContent` 设置，从不作为 HTML。
- **校验。** 错误的 `rich` 选项（无效颜色、负数尺寸、错误的 `padding` 形式、未知 `align`）会在更改当前图表之前抛出异常。

没有 `rich` 的柱状图标签和没有 `label` 的其他图表标签与之前完全相同。
