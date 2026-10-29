# 日历热力图

`renderCalendarHeatmap` 为每天绘制一个单元格，像挂历一样按周排列，并按数值为单元格着色。适合查看数月到数年的每日活动，例如提交次数、销售额或传感器在线率。

[在线示例](https://jparkk0517.github.io/Charturbo/heatmap.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderCalendarHeatmap(
  [
    ['2023-01-02', 4],
    ['2023-01-03', 7],
    ['2023-01-05', null], // 无数据
  ],
  { range: 2023, firstDay: 1, title: '每日提交', valueLabel: '提交' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderCalendarHeatmap(data: CalendarHeatmapData, options?: CalendarHeatmapOptions): { dayCount: number; calendarCount: number }
```

## 数据格式

```ts
type CalendarDate = string | number | Date;
type CalendarHeatmapData = ArrayLike<readonly [CalendarDate, number | null | undefined]>;
```

- `'YYYY-MM-DD'` 字符串按字面日期使用，不应用时区。
- 纪元毫秒、`Date` 对象以及带时间的 ISO 字符串（`'2023-01-02T09:00Z'`）按图表时区中的日期计算：`options.timeZone`，否则为 SDK 时区（`setTimeZone`，默认 `'local'`）。不带 `Z` 或偏移量的时间先按浏览器时区解析（`Date.parse`）。参见[数据与坐标轴](../guide/data-and-axes)。
- 值为 `null`、`undefined` 或 `NaN` 表示当天无数据。同一天出现两次时取最后一个值。
- 不在任何范围内的日期会被忽略。`'2023-02-30'` 这类无效日期会抛出异常。

## 范围与多个日历

`range` 设置一个日历，`ranges` 设置多个；多个日历横向时自上而下堆叠，纵向时并排放置。

| 值 | 含义 |
| --- | --- |
| `2023` 或 `'2023'` | 整年 |
| `'2023-02'` | 一个月 |
| `'2023-02-14'` | 一天 |
| `['2023-01-15', '2023-03']` | 包含两端的区间；终点为月份或年份时取其最后一天 |

未设置 `range` 和 `ranges` 时，数据覆盖的每一年各生成一个日历（无数据时为当年）。起点晚于终点的范围会抛出异常。所有范围合计最多 40,000 天。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `range` | `CalendarRange` | 数据所在年份 | 一个日历。 |
| `ranges` | `CalendarRange[]` | | 多个日历，优先于 `range`。 |
| `orient` | `'horizontal' \| 'vertical'` | `'horizontal'` | 横向：周从左到右，星期为行。纵向：周从上到下，星期为列。 |
| `cellSize` | `number` | 自适应 | 单元格最大边长（CSS px），会缩小以适应绘图区。 |
| `cellGap` | `number` | `2` | 单元格间距（CSS px）。 |
| `firstDay` | `number` | `0` | 一周的第一天：`0` 周日到 `6` 周六。其他值会抛出异常。 |
| `dayLabels` | `boolean \| { show?, names? }` | `true` | 星期名称。`names`：从周日开始的 7 个名称。单元格较小时隔一行或隔两行显示。 |
| `monthLabels` | `boolean \| { show?, names? }` | `true` | 月份名称。`names`：从一月开始的 12 个名称。会重叠的标签将被省略。 |
| `yearLabel` | `boolean` | `true` | 每个日历的年份（跨年时为 `2023–2024`）。 |
| `splitLine` | `boolean \| { show?, color?, width? }` | `true` | 月份分隔线。默认颜色为主题基线色，宽度 1 px。 |
| `colorScale` | `HeatmapColorScale` | `'sequential'` | 色阶，与[热力图](./heatmap)相同：`'sequential'`、`'viridis'`、`'magma'`、`'diverging'` 等。 |
| `color` | `ColorInput` | | sequential / diverging 色阶的色相。 |
| `reverse` | `boolean` | `false` | 反转色阶。 |
| `min`、`max`、`center` | `number` | 数据范围 | 数值域；`center` 为 diverging 的中点。 |
| `emptyColor` | `ColorInput` | 主题网格色 | 无数据日期的颜色。 |
| `colorbar` | `boolean \| HeatmapColorbarOptions` | `true` | 日历右侧的色条（`title` 默认为 `valueLabel`）。 |
| `timeZone` | `CharturboTimeZone` | SDK 时区 | 将纪元毫秒 / `Date` 转换为日期所用的时区。 |
| `valueLabel` | `string` | `'Value'`（本地化） | 提示框、数据表和色条中的数值名称。 |
| `format` | `ChartValueFormat` | 区域数字格式 | 提示框和无障碍文本中的数值格式。参见[数字与日期格式](../guide/number-format)。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

星期和月份名称跟随图表区域设置（`setLocale`）。日历没有图例。

## 交互

调用 `enableNodeInteractions(canvas)` 开启交互。悬停在任意一天（包括无数据的日期）上会高亮该单元格并显示日期和数值。刷选、缩放和平移已禁用。数据点 id 按顺序计数所有日历中的日期（第一个日历的第一天为 `0`）。

提示框上下文（参见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'calendar'
// ctx.index = 日期 id
// ctx.calendar = { date: '2023-01-02', day, value, calendar }  // value 为 NaN 表示无数据
```

## 说明

- 布局、月份分隔线、标签锚点、命中检测和色阶均在引擎（Rust）中计算。单元格是矢量图元，`exportChartSVG` 会将其写为 SVG 路径。
- 无障碍：摘要给出时间跨度、有数据的天数和数值范围。数据表和 `exportChartCSV` 列出有数据的日期（日期、数值）。按键：上 / 下移动一天，左 / 右移动一周（纵向时互换），Page Up / Page Down 移动一个月，Home / End 跳到第一天 / 最后一天。参见[无障碍](../guide/accessibility)。
- React / Vue：`type="calendar"`。

## 另请参阅

- [热力图](./heatmap)
- [数据与坐标轴](../guide/data-and-axes)
- [提示框与悬停](../guide/tooltips)
