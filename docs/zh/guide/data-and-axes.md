# 数据与坐标轴

本页说明 2D 图表中系列数据如何映射到 x 轴和 y 轴：样本索引与真实 x 值、时间轴与时区、对数 / 反向刻度、y 值域、第二 y 轴，以及范围选择器条带。大部分内容适用于折线图和面积图；柱状图、散点图和 K 线图在文中注明处接受相同的坐标轴选项。

[在线示例](https://jparkk0517.github.io/Charturbo/line.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });
sdk.renderLineChart(
  [
    { name: 'CPU', values: cpu, x: timestamps },      // Date[] 或 epoch ms（Float64Array / number[]）
    { name: 'GPU', values: gpu, x: otherTimestamps }, // 各系列的长度和间隔可以不同
  ],
  {
    axes: {
      x: { type: 'time', title: '时间' },
      y: { title: '使用率 (%)', min: 0, max: 100 },
    },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

## 系列数据

- `values` 为 `Float32Array` 或 `number[]`。`NaN`、`null`、`undefined` 表示缺失样本，绘制方式由 `nulls` 决定（见[折线图](../charts/line)）。
- 不提供 `x` 时，样本按索引等间距排列。默认 x 标签和提示框显示带 `xLabelPrefix` 前缀的索引（`T` 显示为 `T+120`）。
- 提供 `x` 时，每个样本都有真实 x 值：与 `values` 等长的 `Float64Array`、`number[]` 或 `Date[]`。
  - 要么所有系列都提供 `x`，要么都不提供。
  - 值必须有限且升序排列（允许相等），否则 render 调用会抛出错误。间隔可以不规则。
  - 各系列的长度和间隔可以不同。x 范围由所有系列共享。
  - epoch 毫秒以相对最小值的 f64 偏移存储，因此保留毫秒精度。

## 时间轴

`axes.x.type` 决定如何解读数值型 `x`：

- `'numeric'`：1 / 2 / 5 × 10ⁿ 步长的刻度。数值型 `x` 的默认值。
- `'time'`：将 `x` 视为 epoch 毫秒。`x` 为 `Date[]` 时的默认值。

时间刻度落在图表时区的日历边界上：1、2、5、10、15、30 秒或分钟；1、3、6、12 小时；1、2 天；1 周（周一）；1、3、6 个月；1、2、5、10、… 年。默认标签格式取决于刻度所在的边界（`HH:mm`、`MMM d`、`MMM`、`yyyy`）。如需修改标签，请传入 `axes.x.format(value, granularity)`，详见[数字与日期格式](./number-format#date-and-time-labels)。

K 线图和 OHLC 图以相同方式读取 `t`：提供 `t` 时，`axes.x.type` 默认为 `'time'`。

## 时区 {#time-zones}

```ts
const sdk = await Charturbo.create(canvas, { timeZone: 'Asia/Seoul' }); // 'UTC' | 'local' | IANA 名称
sdk.setTimeZone('America/New_York'); // 重绘当前图表的刻度和标签
sdk.getTimeZone();                   // 'America/New_York'

// 图表自身的选项优先于 SDK 设置
sdk.renderLineChart(series, { axes: { x: { type: 'time' } }, timeZone: 'UTC' });
sdk.renderCandlestickChart(ohlc, { timeZone: 'Europe/Berlin' });
```

- 默认值为 `'local'`，即查看者所在的时区。
- 所有时间文本使用同一时区：x 轴刻度标签、提示框与 `getNodeDetails`、无障碍摘要、数据表以及 `exportChartCSV()`。
- 刻度落在本地边界上：午夜、月初、年初、夏令时当天（23 小时 / 25 小时）的整点，以及 +05:30、+05:45 等偏移时区的整点。
- 未知的时区名称会抛出 `RangeError`（`create`、`setTimeZone`）。
- 适用于折线图、面积图和 K 线图的 `'time'` x 轴。数值轴、对数轴、索引轴以及热力图范围不受影响。

::: tip 提示
对于服务端渲染或快照测试等不应依赖运行环境的输出，请显式设置 `'UTC'` 或 IANA 名称。
:::

## 坐标轴选项

`axes.x`、`axes.y` 以及（折线图）`axes.y2` 接受以下选项：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `show` | `boolean` | `true` | 显示刻度标签 |
| `title` | `string` | — | 刻度标签旁的坐标轴标题 |
| `format` | 格式说明符字符串、`Intl.NumberFormatOptions` 或 `(value, granularity?) => string` | 本地化数字 / 时间标签 | 刻度标签文本，见[数字与日期格式](./number-format) |
| `labelRotate` | `number` | `0` | 仅限 x 轴：刻度标签旋转角度（度），正值为逆时针，-90..90（ECharts `axisLabel.rotate`），见[柱状图](../charts/bar#label-rotation) |
| `type` | `'numeric' \| 'time'` | x 为 `Date[]` 时为 `'time'`，否则为 `'numeric'` | 仅限折线图 / K 线图的 x 轴 |
| `scale` | `'linear' \| 'log'` | `'linear'` | 数值刻度（折线图、面积图、散点图） |
| `reverse` | `boolean` | `false` | y 向下增长，x 向左增长 |
| `tickCount` | `number` | y：网格行数；x：约每 90 px 一个 | 目标刻度数 |
| `min` / `max` | `number` | 由数据决定 | 折线图 y 值域的固定端 |
| `autoscale` | `'all' \| 'visible' \| 'none'` | `'all'` | 折线图 y 值域跟随数据的方式 |
| `nice` | `boolean` | `true` | 将由数据决定的端点扩展到整刻度 |

最后三行以及 `min` / `max` 为折线图 / 面积图的 y 轴选项（`axes.y`、`axes.y2`）。刻度采用 1 / 2 / 5 × 10ⁿ 步长，网格线绘制在相同位置。

## 对数、反向与刻度数

```ts
sdk.renderLineChart(series, { axes: { x: { scale: 'log' }, y: { reverse: true, tickCount: 4 } } }); // 需要正数数值 x
sdk.renderScatterChart(data, { axes: { x: { scale: 'log' }, y: { scale: 'log' } } });

sdk.setAxisScale('y', { scale: 'log' }); // 'x' | 'y' | 'y2'，合并到当前选项
sdk.getAxisScale('y');                   // { scale, reverse, tickCount } | null
```

- `scale: 'log'` 使用 log10 与十的幂次刻度（范围较窄时添加 1 / 2 / 5 次刻度）。小于等于 0 的值不绘制：折线断开，散点被跳过。
- 折线图的对数 x 轴仅在所有系列的 `x` 都是正数数值时生效。索引 x、时间 x 或存在小于等于 0 的 x 时保持线性（`reverse` 和 `tickCount` 仍然生效）。
- 缩放、降采样、悬停、标注和范围 API 在所有刻度下均可正常工作。更改坐标轴刻度会重置该轴的缩放。
- `setAxisScale` 适用于折线图、面积图和散点图。

## y 值域 {#y-domain}

折线图 / 面积图的 y 值域由引擎根据 `axes.y` 计算：

```ts
sdk.renderLineChart(series, { axes: { y: { min: 0, autoscale: 'visible', nice: true } } });
sdk.setYDomain({ autoscale: 'all' }); // 合并到当前选项；传入 min: undefined 可释放一端
sdk.getYDomain();                     // [min, max] | null
```

- `'all'`（默认）：全部数据的范围，数据变化时重新计算。
- `'visible'`：x 缩放窗口内可见系列的范围。缩放、平移和数据更新时带滞后地重新计算：仅当数据超出值域或跨度小于值域的 60% 时才更新，因此坐标轴不会抖动。
- `'none'`：计算一次后保持不变，即使数据变化。
- `min` / `max` 固定对应一端。`nice` 只扩展由数据决定的端点。
- 在 `autoscale: 'all'` 下，隐藏系列不会改变 y 范围。
- 手动 y 缩放（`setYRange`、Shift + 滚轮）会固定值域，直到重置。详见[交互](./interactions#y-zoom-and-box-zoom)。

K 线图改用 `yFit: 'visible' | 'all'`（默认 `'visible'`）。组合图的 y 值域是固定的，通过 `axes.y` / `axes.y2` 的 `min`、`max`、`nice` 设置（见[组合图](../charts/combo)）。

## 双 y 轴

第二 y 轴需要显式启用：任一折线系列设置 `yAxis: 'right'` 时开启。

```ts
sdk.renderLineChart(
  [
    { name: '气温', values: temp },
    { name: '降水量', values: rain, yAxis: 'right' },
  ],
  { axes: { y: { title: '°C' }, y2: { title: 'mm', scale: 'log', min: 1, format: (v) => `${v} mm` } } }
);
sdk.setY2Domain({ autoscale: 'visible' }); // 与 setYDomain 相同的选项，作用于右轴
sdk.getY2Domain();                         // [min, max] | null
sdk.setAnnotations([{ type: 'hline', y: 100, yAxis: 'right', label: '暴雨阈值' }]);
```

- 仅限 2D 折线图。面积图和 2.5D 视图不显示右轴标签。
- 右轴拥有独立的值域、autoscale、刻度类型和刻度。网格线跟随左轴。SDK 会为右轴标签和标题预留右侧边距。
- 标注通过 `yAxis: 'right'` 使用右轴。

::: warning 注意
使用两个 y 轴时，交点和斜率取决于各轴范围的选取方式，容易造成误读。对于单位不同的两个指标，请优先考虑：共享 x 的小型多图（通过[仪表盘联动](./dashboard-sync)同步缩放）、单一指数化坐标轴（首值 = 100 或百分比变化），或以一个值对另一个值绘制的散点图。仅当 x 对齐是关键时才使用双轴，并用坐标轴标题和系列颜色清楚标明各轴。
:::

## 范围选择器

绘图区下方的条带显示完整 x 范围及一个可拖动的缩放窗口。

```ts
sdk.renderLineChart(series, { navigator: true }); // 或 { navigator: { height: 64 } }（CSS px，默认 48）
sdk.renderAreaChart(series, { mode: 'stacked', navigator: true });
sdk.enableNodeInteractions(canvas);
sdk.on('rangechange', ({ xMin, xMax }) => { /* 拖动窗口、手柄和滚轮也会触发 */ });
sdk.getNavigatorRect(); // [left, top, width, height]，CSS px；没有时为 null
```

- 仅限 2D 折线图和面积图。
- 在窗口内拖动可移动窗口；拖动边缘（±8 px）可调整大小；在窗口外点击会将窗口中心移到该处并继续拖动；在条带上滚动滚轮会以指针为中心缩放。鼠标、触摸和笔在条带上按下时都会操作窗口。
- 条带按条带宽度对完整 x 范围内的可见系列进行降采样后绘制，因此即使有 100 万以上的数据点也很轻量。仅在数据、可见性或视图变化时重建。

[在线示例：范围选择器](https://jparkk0517.github.io/Charturbo/candlestick.html)

## 柱状图与散点图坐标轴

- 柱状图的 `axes.x` / `axes.y` 接受 `show`、`title`、`format`，`axes.x` 还接受 `labelRotate`。设置 `orientation: 'horizontal'` 时，`axes.x` 为数值轴，`axes.y` 为类目轴。见[柱状图](../charts/bar)。
- 散点图的 `axes.x` / `axes.y` 还接受刻度选项（`scale`、`reverse`、`tickCount`）。两个轴都可以缩放和平移。见[散点图 · 气泡图](../charts/scatter)。

## 另请参阅

- [交互](./interactions)：缩放、平移、范围与事件
- [数字与日期格式](./number-format)
- [实时数据流](./streaming)
- [折线图](../charts/line) · [面积图](../charts/area) · [组合图](../charts/combo)
