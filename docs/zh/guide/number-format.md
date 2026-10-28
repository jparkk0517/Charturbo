# 数字与日期格式

坐标轴刻度标签、柱状图数据标签和提示框数值都可以指定格式：函数、d3-format 风格的说明符字符串，或 `Intl.NumberFormatOptions` 对象。默认标签和时间标签遵循图表的区域设置与时区。

## 基本用法

```ts
import { Charturbo, createFormatter, formatNumber } from 'charturbo';

const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
sdk.renderLineChart(series, {
  axes: {
    x: { format: ',d' },
    y: { format: '.2s' },
    y2: { format: { style: 'percent' } },
  },
});
sdk.enableNodeInteractions(canvas, { tooltip: { valueFormatter: '$,.2f' } });
sdk.render();

formatNumber(1234.5, '$,.2f');                               // "$1,234.50"
formatNumber(1234.5, '$,.2f', 'de-DE', { currency: 'EUR' }); // "1.234,50 €"
const fmt = createFormatter('bytes', { locale: 'ko-KR' });   // (v) => string，可复用
fmt(1536);                                                   // "1.5 KB"
```

## 格式的适用位置

| 选项 | 接受的值 |
|---|---|
| `axes.x.format`、`axes.y.format`、`axes.y2.format` | 函数、说明符字符串、`Intl.NumberFormatOptions` |
| 柱状图 `labels.format` | `(value, ctx) => string`、说明符字符串、`Intl.NumberFormatOptions` |
| `enableNodeInteractions({ tooltip: { valueFormatter } })` | `(v) => string`、说明符字符串、`Intl.NumberFormatOptions` |
| 饼图 `format`、热力图色条 `format` | 仅函数 |

说明符字符串会针对图表区域设置编译一次为 `Intl.NumberFormat` 并缓存。调用 `setLocale` 后，刻度会以新的区域设置重新绘制。

## 说明符语法

`[sign][$][,][.precision][~][type]`

| 说明符 | 示例（en-US） | 说明 |
|---|---|---|
| `'.2f'`、`',.0f'` | `1234.57`、`1,234,568` | 定点小数；`,` 添加千位分隔符 |
| `'d'`、`',d'` | `4`、`12,345` | 整数（四舍五入） |
| `'.1%'` | `12.3%` | 百分比（× 100） |
| `'.2s'` | `1.5k`、`1.2M`、`1.2m` | SI 前缀（有效数字；舍入可能进位到下一个前缀） |
| `'.2e'` | `1.23e+4` | 指数 |
| `'$,.2f'` | `$1,234.50` | 货币（`Intl` `style: 'currency'`，代码取自 `currency` 选项，默认 `USD`） |
| `'compact'`、`'.1compact'` | `1.5K`、`2M` | `Intl` 紧凑表示法 |
| `'bytes'`、`'.2bytes'` | `1.5 KB`、`1.50 KB` | 1024 进制单位（B、KB、MB、GB、TB、PB、EB） |
| `'+.1f'` | `+1.3`、`-2.0`、`0.0` | 正负数均显示符号（零不带符号） |

- `sign`：`+` 为正数和负数显示符号；`-`（默认）仅为负数显示。
- `$` 只能与无类型、`f`、`d` 或 `compact` 一起使用。
- `.precision` 对 `f`、`%`、`e`、`compact`、`bytes` 表示小数位数，对 `s` 和无类型表示有效数字。
- `~` 去除末尾无意义的零（`'.3~s'` 得到 `1.5k`）。
- 省略精度时与 d3-format 一样默认为 6（`d`：0，`compact`：`Intl` 默认，`bytes`：1）。无类型时使用区域设置的默认数字格式。
- 无效说明符会在图表渲染时抛出 `TypeError`。

## 辅助函数

| 函数 | 说明 |
|---|---|
| `formatNumber(value, spec, locale?, { currency? })` | 格式化单个值 |
| `createFormatter(spec, options?)` | 返回可复用的 `(value) => string`；`options` 为区域设置字符串或 `{ locale, currency }`。函数形式的 `spec` 原样返回 |

## 区域设置

默认标签和提示框数值的区域设置按以下顺序确定：

1. 图表的 `locale` 选项（折线图、面积图、K 线图等接受该选项的图表）；
2. SDK 区域设置：`Charturbo.create(canvas, { locale })` 或 `sdk.setLocale(locale)`；
3. 运行时（浏览器）区域设置。

```ts
const sdk = await Charturbo.create(canvas, { locale: 'ko-KR' });
sdk.setLocale('de-DE'); // 重新格式化当前图表的刻度标签和提示框数字
sdk.getLocale();        // 'de-DE'
sdk.setLocale(undefined); // 恢复为运行时区域设置
```

内置 UI 文本（无障碍摘要、数据表表头、提示框字段标签、导出 / 图例 / 范围选择器文本）也遵循同一区域设置：内置 en、ko、zh-CN，未知区域设置回退为英文，`undefined` 使用浏览器语言。详见[国际化](./i18n)。

## 日期与时间标签 {#date-and-time-labels}

在 `'time'` x 轴上，默认刻度标签取决于刻度所在的日历边界（`ChartTimeGranularity`），并按图表的区域设置和时区通过 `Intl.DateTimeFormat` 格式化：

| 粒度 | 标签 |
|---|---|
| `'millisecond'` | `HH:mm:ss.SSS` |
| `'second'` | `HH:mm:ss` |
| `'minute'`、`'hour'` | `HH:mm` |
| `'day'` | `MMM d` |
| `'month'` | `MMM` |
| `'year'` | `yyyy` |

提示框显示完整的日期和时间（本地午夜时仅显示日期，仅在存在毫秒时显示毫秒）。

如需自定义，请传入函数。刻度会收到粒度；提示框调用时不传粒度：

```ts
import { formatChartTime } from 'charturbo';

sdk.renderLineChart(series, {
  axes: {
    x: {
      type: 'time',
      format: (ms, granularity) =>
        granularity === 'day' ? new Date(ms).toISOString().slice(5, 10) : formatChartTime(ms, granularity, 'en-GB', 'UTC'),
    },
  },
});

formatChartTime(Date.UTC(2026, 0, 1, 9), 'hour', 'ko-KR', 'Asia/Seoul'); // 单个值的默认标签
```

`formatChartTime(ms, granularity?, locale?, timeZone = 'UTC')` 是纯函数：其时区默认为 `'UTC'`，而不是图表时区。时区说明见[数据与坐标轴](./data-and-axes#time-zones)。

::: warning 注意
在时间轴上使用说明符字符串时，会将 epoch 毫秒作为普通数字格式化。日期标签请使用函数或默认格式。
:::

## 另请参阅

- [数据与坐标轴](./data-and-axes)
- [提示框与悬停](./tooltips)
- [国际化](./i18n)
- [柱状图](../charts/bar)：数据标签
