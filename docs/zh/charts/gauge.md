# 仪表盘

`renderGauge` 在 `min` 与 `max` 之间的圆弧上显示单个值，可带阈值区间（band）以及指针或进度指示。适合展示一个有明确范围的实时指标，例如 CPU 负载或 SLA 目标。

[在线示例](https://jparkk0517.github.io/Charturbo/business.html)

## 基本用法

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGauge(
  { value: 72 },
  {
    title: 'CPU 负载',
    min: 0,
    max: 100,
    label: 'CPU',
    format: '.0f',
    bands: [
      { from: 0, to: 60, status: 'good' },
      { from: 60, to: 85, status: 'warning' },
      { from: 85, to: 100, status: 'critical', label: '过载' },
    ],
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

签名：

```ts
renderGauge(data: GaugeChartData, options?: GaugeChartOptions): { bandCount: number }
```

## 数据格式

```ts
interface GaugeChartData {
  value: number; // NaN = 无值；超出 [min, max] 的值固定在两端
}
```

范围或区间无效时抛出异常。

## 选项

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `min` | `number` | `0` | 范围起点。 |
| `max` | `number` | `100` | 范围终点。 |
| `bands` | `GaugeBandOptions[]` | | 以数值为单位的阈值区间。裁剪到范围内；区间重叠时，起点靠后的区间优先。 |
| `indicator` | `'needle' \| 'progress'` | 有区间时 `'needle'`，否则 `'progress'` | 指针，或填充到当前值的圆弧。 |
| `startAngle` | `number` | `-120` | 圆弧起始角度（从 12 点方向顺时针，单位为度）。 |
| `endAngle` | `number` | `120` | 圆弧结束角度（从 12 点方向顺时针，单位为度）。 |
| `thickness` | `number` | `0.2` | 圆环厚度占半径的比例。 |
| `bandLabels` | `boolean` | 有区间带 `label` 或 `status` 时为 `true` | 区间旁的标签。 |
| `showMinMax` | `boolean` | `true` | 圆弧两端的最小 / 最大值标签。 |
| `label` | `string` | | 数值下方的说明文字（单位或指标名）。 |
| `trackColor` | `ColorInput` | 主题网格颜色 | 未填充圆弧的颜色。 |
| `color` | `ColorInput` | 调色板第一个颜色 | 值不在任何区间内时的进度颜色。 |
| `needleColor` | `ColorInput` | 主题主文本颜色 | 指针颜色。 |
| `format` | `ChartValueFormat` | 本地化数字 | 当前值、最小值、最大值的文本格式（格式字符串、`Intl` 选项或函数）。见[数字与日期格式](../guide/number-format)。 |
| `valueLabel` | `string` | `'数值'`（随语言区域） | 提示框和数据表中数值的名称。 |
| `title` | `string` | | 图表标题。 |
| `description` | `string` | | 画布的无障碍名称。 |
| `padding` | `ChartPaddingOptions` | 自动 | 绘图区边距（CSS px）。 |

仪表盘没有图例。

### 区间

```ts
interface GaugeBandOptions {
  from: number;
  to: number;
  status?: 'good' | 'warning' | 'serious' | 'critical'; // 预留的状态颜色 + 图标 + 标签
  color?: ColorInput;  // 默认：状态颜色，否则为主题调色板颜色
  label?: string;      // 显示在区间旁和提示框中（默认：状态名称）
}
```

状态颜色是预留的，不随主题变化。状态始终与图标和标签一起显示，不单靠颜色表达含义。

| 状态 | 颜色 | 图标 | 默认标签 |
| --- | --- | --- | --- |
| `good` | `#0ca30c` | ✓ | 良好（随语言区域） |
| `warning` | `#fab219` | ▲ | 警告（随语言区域） |
| `serious` | `#ec835a` | ◆ | 严重（随语言区域） |
| `critical` | `#d03b3b` | ✖ | 危急（随语言区域） |

只设置 `color` 而没有 `status` 的区间是普通区间。

## 更新数值

```ts
setGaugeValue(value: number): boolean
```

`setGaugeValue` 将当前仪表盘移到新值。区间几何和标签布局保持不变，只更新指针（或进度弧）和中心数值文字。调用后需执行 `render()`。没有仪表盘或值为无穷时返回 `false`。

```ts
setInterval(() => {
  sdk.setGaugeValue(Math.random() * 100);
  sdk.render();
}, 1000);
```

数值变化没有动画。

## 交互

调用 `enableNodeInteractions(canvas)` 开启。悬停在圆环上显示指针下的区间，悬停在内侧显示当前值。不支持刷选、缩放和平移。

提示框上下文（见[提示框与悬停](../guide/tooltips)）：

```ts
// ctx.chartType === 'gauge'
// ctx.index：0 = 当前值，1 + k = 区间 k（区间按 `from` 排序）
// ctx.gauge = { value, min, max, band?: { label, from, to, status? } }
```

数据点 id：`0` = 当前值，`1 + k` = 绘制顺序中的区间 `k`。

## 说明

- 圆弧、区间和轨道的三角剖分（区间间 2 px 间隙、边缘抗锯齿）、区间裁剪与排序、当前值所属区间、指针、命中测试和标签锚点均在引擎（Rust）中计算。
- 无障碍：摘要（值、状态、范围）、数据表（值，以及每个区间的 From–To），左右方向键从当前值依次移到各区间。见[无障碍](../guide/accessibility)。

## 另请参阅

- [雷达图](./radar)
- [实时数据流](../guide/streaming)
- [提示框与悬停](../guide/tooltips)
- [数字与日期格式](../guide/number-format)
