# 漏斗图

`renderFunnelChart` 按顺序绘制各阶段，宽度随数值变化，并显示阶段之间的转化率。适合查看逐步流失，例如访问 → 注册 → 付费。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderFunnelChart(
  { labels: ['访问', '注册', '试用', '付费'], values: [12000, 5400, 2100, 760] },
  { title: '转化漏斗', conversion: 'both', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderFunnelChart(data: FunnelChartData, options?: FunnelChartOptions): { stageCount: number }
```

## 数据格式

```ts
interface FunnelChartData {
  labels: string[];                  // 阶段名称，第一阶段在前
  values: Float64Array | number[];   // 有限且 >= 0
}
```

值必须有限且 `>= 0`，否则抛出异常。阶段宽度以最大值为基准。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | 纵向：第一阶段在顶部，标签在右侧。横向：标签在阶段下方。 |
| `shape` | `'trapezoid' \| 'bar'` | `'trapezoid'` | 梯形收窄到下一阶段的宽度（最后一段为矩形）；`'bar'` 绘制居中的条形。 |
| `color` | `ColorInput` | 调色板第一个颜色 | 所有阶段使用的单一颜色（一个系列，一种色相）。 |
| `colors` | `(ColorInput \| null \| undefined)[]` | | 每个阶段的颜色（例如有序色阶）。缺省项使用 `color`。 |
| `minWidth` | `number` | `0.02` | 最窄阶段占最宽阶段的比例。 |
| `conversion` | `'first' \| 'previous' \| 'both' \| 'none'` | `'first'` | 阶段标签显示的转化率。提示框始终显示两者。 |
| `labels` | `boolean` | `true` | 阶段标签。 |
| `format` | `ChartValueFormat` | 本地化数字 | 标签、提示框和无障碍文本的数值格式（格式字符串、`Intl` 选项或函数）。见[数字与日期格式](../guide/number-format)。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 提示框和数据表中数值的名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。会自动为标签留出空间。 |

漏斗图没有图例。

## 转化率

引擎为每个阶段计算两种比率：

- **相对首阶段（of first）**：该阶段值占第一阶段值的百分比。
- **相对上一阶段（of previous）**：该阶段值占上一阶段值的百分比。

除以零得到的比率为 `NaN`（未定义）。用 `conversion` 选择标签显示哪种比率。

## 交互

调用 `enableNodeInteractions(canvas)` 开启。悬停的阶段会变亮，提示框显示数值和两种比率。不支持刷选、缩放和平移。数据点 id 为阶段索引。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'funnel'
// ctx.index = 阶段索引
// ctx.funnel = { stage, value, ofFirst, ofPrevious }  // NaN = 未定义
```

## 说明

- 校验、阶段宽度、转化率、三角剖分（2 px 间隙、边缘抗锯齿）、命中测试和标签锚点均在引擎（Rust）中计算。
- 无障碍：摘要（首阶段 → 末阶段、整体转化率）、数据表（阶段、值、% of first、% of previous），左右方向键在阶段间移动。见[无障碍](../guide/accessibility)。

## 另请参阅

- [瀑布图](./waterfall)
- [饼图 · 环形图](./pie)
- [桑基图](./sankey)
- [提示框与悬停](../guide/tooltips)
