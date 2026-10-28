# Dashboard Sync

Charts on one page can share the hover cursor and the x zoom / pan. Each chart keeps its own canvas and engine; only data-unit positions travel between them. Use it for dashboards and for small multiples that share an x axis.

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvases = [cpuCanvas, memCanvas, netCanvas];
const data = [cpuSeries, memSeries, netSeries];
const charts = await Promise.all(canvases.map((c) => Charturbo.create(c)));
charts.forEach((sdk, i) => {
  sdk.renderLineChart(data[i], { axes: { x: { type: 'time' } } });
  sdk.enableNodeInteractions(canvases[i], { autoRender: true });
  sdk.render();
});

const disconnect = Charturbo.connect(charts, { cursor: true, x: true }); // both default true
// later
disconnect();
```

## Sync groups by key

Instead of an array, charts can join a named group, like ECharts `group` or Highcharts synchronized charts:

```ts
const a = await Charturbo.create(canvasA, { sync: { key: 'dash', tooltip: true } });
const b = await Charturbo.create(canvasB);
b.setSync({ key: 'dash' });   // join later; setSync(null) leaves
b.getSync();                  // { key: 'dash', cursor, x, tooltip } | null

const disband = Charturbo.connect('dash', { x: false }); // group-wide options
disband(); // every member leaves the group
```

- `Charturbo.connect(array, options)` forms a new group; the returned function disconnects those charts.
- `Charturbo.connect(key, options)` sets the options of every chart that joins `key`; a member's own options win. The returned function disbands the group.
- Joining a group leaves any previous one. `dispose()` leaves the group.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `key` | `string` | — | Group name (`create({ sync })`, `setSync`) |
| `cursor` | `boolean` | `true` | Share the hover: the other charts show crosshair and markers at the hovered data x |
| `x` | `boolean` | `true` | Share x zoom / pan in data units |
| `tooltip` | `boolean` | `false` | Followers also show their tooltip at the synced x |
| `y` | `false` | — | y ranges are never shared |

## How it works

- **Cursor**: the hovered chart reports its data x (line: series `x` / epoch ms or the sample index; bar: category index; scatter: x). The others hit-test that x in index mode and draw a crosshair and the nearest marker per series. Bars highlight the category at `round(x)`; scatter charts mark the nearest point per series without a crosshair. An x outside a chart's range clears its hover, and leaving clears all.
- **Zoom / pan**: a `'rangechange'` on one chart calls `setXRange` on the others in data units; each engine clamps the range to its own domain.
- Echoes from synced changes are ignored, so there is no feedback loop. Updates are collected and applied once per animation frame per group, and only charts that changed re-render.
- The hovered chart needs `enableNodeInteractions`.

::: tip
Synced positions are data units. Charts in one group should share the same x units: all epoch ms on time axes, or all sample / category indices.
:::

## Manual cursor

```ts
sdk.hoverAtX(Date.parse('2026-01-01T09:00Z')); // hover at a data x without emitting 'hover'
sdk.getHoverX();                               // data x of the current hover, or null
sdk.hoverAtX(null);                            // clear
sdk.render();
```

`hoverAtX(x, { tooltip: true })` also shows the built-in tooltip. Use it to drive charts from your own controls, such as a time slider.

## React and Vue

The components take a `syncGroup` prop: a key string or full member options.

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={cpuSeries} syncGroup="dash" />
<CharturboChart type="line" data={memSeries} syncGroup={{ key: 'dash', tooltip: true }} />
```

```vue
<script setup lang="ts">
import { CharturboChart } from 'charturbo/vue';
</script>

<template>
  <CharturboChart type="line" :data="cpuSeries" sync-group="dash" />
</template>
```

## See also

- [Interactions](./interactions): `rangechange`, `setXRange`
- [Tooltips & Hover](./tooltips): `hoverAtX`, pinned tooltips
- [Data & Axes](./data-and-axes): why small multiples often beat a dual y axis
- [React](./react) · [Vue](./vue)
