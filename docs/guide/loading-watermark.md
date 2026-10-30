# Loading & Watermarks

[Live example](https://jparkk0517.github.io/Charturbo/export.html)

## Loading indicator

`showLoading` covers the chart with a mask, a spinner and a status text (ECharts `showLoading`). `hideLoading` removes it.

```ts
sdk.showLoading();                                  // "Loading…" in the chart language
const data = await fetchData();
sdk.renderLineChart(data);
sdk.render();
sdk.hideLoading();
```

**Rendering does not hide the indicator.** Call `hideLoading` when your data is ready. Calling `showLoading` again updates the options of the visible indicator. `isLoading()` tells whether it is shown.

| Option | Default | Meaning |
|---|---|---|
| `text` | `'Loading…'` (en), `'로딩 중…'` (ko), `'加载中…'` (zh) | Status text |
| `maskColor` | theme surface at 80% | Mask over the chart |
| `color` | first palette color | Spinner color |
| `textColor` | theme primary text | Text color |
| `fontSize` | `12` | Text size in CSS px |
| `spinner` | `true` | `false` shows the text only |
| `delay` | `0` | Milliseconds before the mask appears. Fast loads never flash it |

- **Accessibility.** The chart container gets `aria-busy="true"` at once (its previous value comes back on hide). The text is announced through a polite live region. Under `prefers-reduced-motion` the spinner does not turn.
- **Themes and language.** Default colors follow `setTheme`, and the default text follows `setLocale`.
- **Exports.** PNG, SVG and PDF exports never include the indicator.
- **Validation.** Bad options throw and keep the current indicator.

## Watermark

`setWatermark` draws a text or an image over the chart. It sits above the plot and under labels and tooltips. `null` removes it.

```ts
sdk.setWatermark({ text: 'CONFIDENTIAL' });                          // tiled, rotated 30°
sdk.setWatermark({ text: 'DRAFT', fontSize: 64, repeat: false });   // one centered mark
sdk.setWatermark({ image: '/logo.png', imageWidth: 80, imageHeight: 24, opacity: 0.1 });
sdk.setWatermark(null);
```

| Option | Default | Meaning |
|---|---|---|
| `text` / `image` | — | One of them is required. `image` is a URL, loaded with `crossOrigin = 'anonymous'` |
| `imageWidth`, `imageHeight` | `80`, `40` | Image mark box in CSS px. The image keeps its aspect ratio inside |
| `opacity` | `0.15` | 0..1 |
| `rotate` | `30` | Degrees, positive = anticlockwise |
| `fontSize`, `fontFamily`, `fontWeight` | `14`, theme font, `'400'` | Text font |
| `color` | theme muted text | Text color |
| `gap` | `[80, 60]` | Space between marks in CSS px: a number or `[x, y]` |
| `repeat` | `true` | Tile the whole chart. Odd rows shift by half a mark. `false` draws one centered mark |
| `export` | `true` | Draw in PNG, SVG and PDF exports |

- **Chart level.** The watermark stays when you render another chart. It follows theme switches. `getWatermark()` returns the current options with defaults filled in.
- **Accessibility.** The layer is `aria-hidden` and lets clicks through.
- **Images.** An image that cannot load (or has no CORS headers) draws nothing. A cross-origin image without CORS would block image export, so it is skipped. SVG export links the image by its URL (it is not embedded), so use an absolute or data URL for SVG files opened elsewhere.
- **Validation.** Bad options throw and keep the current watermark.

## React and Vue

`CharturboChart` takes both as props:

```tsx
<CharturboChart type="bar" data={data} loading={isFetching} watermark={{ text: 'DRAFT' }} />
```

```vue
<CharturboChart type="bar" :data="data" :loading="{ text: 'Fetching…' }" :watermark="mark" />
```

`loading` is `true`, the `showLoading` options, or falsy to hide. `watermark` is the `setWatermark` options, or `null` / absent for none. Both are compared by identity (memoize object values in React).
