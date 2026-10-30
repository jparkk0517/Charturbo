# 编辑数据点

折线图和散点图可以像 ECharts 的可拖动数据点那样，让用户拖动数据点修改数值，或点击绘图区添加数据点。编辑默认关闭。不设置 `editable` 时，图表的行为与之前完全相同。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 开启

```ts
sdk.renderLineChart([{ name: 'Target', values: [42, 48, 55, 51, 63] }]);
sdk.enableNodeInteractions(canvas, { autoRender: true, editable: { dragAxis: 'y', min: 0, max: 100 } });

sdk.on('pointDrag', (e) => console.log(e.series, e.index, e.oldValue.y, '→', e.newValue.y));
sdk.on('pointDragEnd', (e) => {
  if (!e.cancelled) save(sdk.getSeriesData(e.series));
});
```

`editable: true` 使用默认值。之后可用 `sdk.setChartEditable(options | false)` 修改选项，用 `sdk.getChartEditable()` 读取当前选项。选项在任何状态改变之前校验：无效的 `dragAxis` 或 `min > max` 会抛出异常并保留当前设置。

| 选项 | 默认值 | 含义 |
|---|---|---|
| `drag` | `true` | 用指针和键盘拖动已有数据点 |
| `dragAxis` | 折线 `'y'`，散点 `'xy'` | 拖动改变的轴：`'x'`、`'y'` 或 `'xy'` |
| `min` / `max` | 无 | y 的限制（数据单位） |
| `xMin` / `xMax` | 无 | x 的限制（数据单位） |
| `addOnClick` | `false` | 点击或轻触绘图区空白处时添加数据点 |
| `addSeries` | `0` | 新数据点所属的系列 |
| `series` | 全部 | 只有这些系列可编辑 |
| `hitRadius` | `10` | 抓取距离（距数据点中心的 CSS px） |

## 拖动行为

- **指针：** 按下数据点即抓住它，因此不会开始平移、刷选或框选缩放。按下后不移动仍是普通点击。鼠标、触摸和触控笔都通过 Pointer Events 工作。
- **限制：** 数值保持在可见绘图范围以及 `min` / `max` / `xMin` / `xMax` 之内。
- **折线的 x 拖动：** 只有系列带 `x` 值时，折线数据点才会在 x 方向移动。它不会越过相邻点，因此 x 始终有序。
- **Escape：** 取消拖动并恢复原值，此时 `pointDragEnd` 带有 `cancelled: true`。
- **实时更新：** 图表通过数据更新路径重绘。不清空场景，缩放、图例和样式状态保持不变。拖动期间折线的 y 域保持固定，松开后重新计算。

## 点击添加

开启 `addOnClick` 后，点击绘图区空白处会在指针下添加数据点并发出 `pointAdd`。点击已有数据点或其附近不算添加。在折线上，新点按 x 顺序插入（没有 `x` 时插入最近的样本索引），其后的索引依次加一。

```ts
sdk.enableNodeInteractions(canvas, { editable: { addOnClick: true, addSeries: 1 } });
sdk.on('pointAdd', (e) => console.log(`series ${e.series} #${e.index}`, e.value));
```

## 键盘

聚焦图表并用方向键移动到数据点后：

- **Shift + 方向键** 将当前数据点移动可见范围的 1/50。
- **Alt + 方向键** 移动可见范围的 1/500（微调）。

上、下改变 y。`dragAxis` 允许时，左、右改变 x。新数值会在图表的实时区域中播报，每次按键都会发出 `source: 'keyboard'` 的 `pointDrag` 和 `pointDragEnd`。

## 事件与数据

| 事件 | 负载 |
|---|---|
| `pointDrag` | 每次移动时 `{ chartType, series, index, oldValue, newValue, source }` |
| `pointDragEnd` | 同上，另加 `cancelled` |
| `pointAdd` | `{ chartType, series, index, value }` |

`sdk.getSeriesData(series)` 以 `{ x, y }` 返回编辑后的数据。散点图还会返回该系列的数据点索引 `index`。没有 `x` 值的折线图，`x` 为样本索引。

React：`onPointDrag`、`onPointDragEnd`、`onPointAdd`。Vue：`@point-drag`、`@point-drag-end`、`@point-add`。`editable` 通过 `interactions` 传入。

## 限制

- **支持的图表：** 2D 折线图和散点图。
- **不可编辑的折线系列：** 堆叠、百分比堆叠、带状、ThemeRiver 和稀疏系列，以及位于附加 y 轴（`yAxisIndex` ≥ 2）上的系列。
- **散点图：** 超出当前域的数据点仍会保留，域在下次渲染之前不会扩大。
