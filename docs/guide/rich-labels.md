# Rich Text Labels

A label can mix sizes, weights, colors and small badges in one text, like ECharts `label.rich`. The label function returns a template, and `rich` maps style names to text styles.

[Live example](https://jparkk0517.github.io/Charturbo/bar.html)

## Template syntax

```ts
'{value|42.5}{unit|k}\n{up|+12%}'
```

- `{name|text}` draws `text` with `rich[name]`. An unknown name draws the text plain.
- `\n` starts a new line.
- `\{`, `\}` and `\\` are literal characters.
- Runs do not nest. A `{` without a `name|` prefix or a closing `}` is plain text, so `{value}` stays as typed.

## Where it works

| Chart | Text function | Context |
|---|---|---|
| Bar / grouped bar | `labels.format` + `labels.rich` | `(value, { category, series, seriesName, categoryLabel, ... })` |
| Pie / donut | `label.formatter` + `label.rich` | `{ name, value, percent, index, ring? }` |
| Treemap, sunburst | `label.formatter` + `label.rich` | `{ name, value, depth }` |
| Sankey | `label.formatter` + `label.rich` | `{ name, value, column }` |
| Funnel | `label.formatter` + `label.rich` | `{ stage, value, percentOfFirst, percentOfPrevious, index }` |

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

## Style options

| Option | Meaning |
|---|---|
| `color` | Text color |
| `fontSize`, `fontWeight`, `fontStyle`, `fontFamily` | Font of the run |
| `backgroundColor`, `padding`, `borderRadius` | Box behind the run. `padding` is `v`, `[vertical, horizontal]` or `[top, right, bottom, left]` |
| `lineHeight` | Line box height of the run |
| `align` | `'left' \| 'center' \| 'right'` for the line the run starts |

Unstyled text uses the chart's own label font and color.

## Layout and export

- **Layout uses the measured text.** Bar fit tests and `'auto'` collision hiding, pie leader-line spacing and side room, and funnel label space all use the size of the styled lines.
- **Treemap.** Cell labels clip to their cell. Header strips show only the first line of the template.
- **Exports.** PNG, SVG and PDF exports draw every run with its own font, color and box.
- **Accessibility.** Screen readers get the plain text without the style names.
- **Safe DOM.** Text is set with `textContent`, never as HTML.
- **Validation.** Bad `rich` options (unknown color, negative size, wrong `padding` shape, unknown `align`) throw before the current chart changes.

Labels without `rich` (bar) or without `label` (other charts) look exactly as before.
