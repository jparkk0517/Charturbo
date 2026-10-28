# 캔들스틱 · OHLC

시가 / 고가 / 저가 / 종가를 그리는 금융 차트입니다. `renderCandlestickChart`는 캔들을 그립니다: 시가에서 종가까지의 몸통과 저가에서 고가까지의 심지입니다. `renderOhlcChart`는 OHLC 막대를 그립니다: 고가–저가 줄기에 왼쪽 시가 틱과 오른쪽 종가 틱이 붙습니다. 두 차트는 시간 축, 거래량 패널, 집계, 탐색 기능을 함께 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/candlestick.html)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });

sdk.renderCandlestickChart(
  { t, open, high, low, close, volume }, // t: Date[] 또는 epoch ms
  { title: 'ACME', hollowUp: true, yFit: 'visible', axes: { y: { format: '$,.2f' } } }
);
sdk.setXRange(t[t.length - 120], t[t.length - 1]); // 마지막 캔들 120개로 시작
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderCandlestickChart(data: CandlestickChartData, options?: CandlestickChartOptions): { candleCount: number }
renderOhlcChart(data: OhlcChartData, options?: OhlcChartOptions): { barCount: number }
```

데이터 포인트 id = 캔들 인덱스.

## 데이터 형식 {#data-format}

`CandlestickChartData`(`OhlcChartData`도 같은 타입)는 모든 배열에 캔들마다 항목 하나를 가집니다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `t` | `Float64Array \| number[] \| Date[]` | 선택 사항. 각 캔들의 x: 시간 축이면 epoch ms 또는 `Date`, `axes.x.type: 'numeric'`이면 일반 숫자. 유한하고 오름차순이어야 합니다. 생략하면 캔들을 인덱스로 배치합니다. |
| `open` | `Float32Array \| number[]` | 시가. |
| `high` | `Float32Array \| number[]` | 고가. |
| `low` | `Float32Array \| number[]` | 저가. |
| `close` | `Float32Array \| number[]` | 종가. |
| `volume` | `Float32Array \| number[]` | 선택 사항. 거래량. 아래쪽 패널에 자체 스케일의 막대로 그립니다. |

시가, 고가, 저가, 종가 중 하나라도 유한하지 않은 캔들은 빈틈이 됩니다.

## 옵션 {#options}

`CandlestickChartOptions`:

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `title` | `string` | — | 차트 제목. |
| `description` | `string` | — | 캔버스의 접근성 이름. |
| `upColor` | `ColorInput` | 테마 palette[0] (파랑) | 상승 캔들 색(종가 ≥ 시가). |
| `downColor` | `ColorInput` | 테마 palette[1] (주황) | 하락 캔들 색. |
| `hollowUp` | `boolean` | `true` | 상승 캔들을 외곽선으로 그려 색 외에 모양으로도 구분합니다. 좁은 캔들은 채웁니다. |
| `wickWidth` | `number` | `1` | 심지 / 외곽선 두께(CSS px). |
| `bodyWidth` | `number` | `0.7` | 캔들 간격에 대한 몸통 너비 비율. |
| `cornerRadius` | `number` | `0` | 몸통 모서리 둥글기(CSS px, 0..1). |
| `showVolume` | `boolean` | `true` | `volume`이 있으면 거래량 패널을 표시합니다. |
| `volumeOpacity` | `number` | `0.45` | 거래량 막대 불투명도. |
| `volumeHeight` | `number` | `0.2` | 플롯에 대한 거래량 패널 높이 비율. |
| `yFit` | `'visible' \| 'all'` | `'visible'` | `'visible'`: 줌 / 팬할 때 가격 축을 보이는 캔들에 맞춥니다. `'all'`: 모든 캔들에 맞춥니다. |
| `axes` | `{ x?: LineXAxisOptions; y?: ChartAxisOptions }` | — | `t`가 있으면 `x.type` 기본값은 `'time'`입니다. [데이터와 축](../guide/data-and-axes) 참고. |
| `locale` | `string` | SDK 로케일 | 기본 라벨과 툴팁 값의 로케일. |
| `timeZone` | `CharturboTimeZone` | SDK 시간대 | 시간 축과 그 라벨의 시간대. |
| `hover` | `ChartHoverStyle` | — | 십자선 스타일(세로선은 캔들 위치, 가로선은 포인터 위치). |
| `showBackdropGrid` | `boolean` | `true` | 가로 그리드 선과 기준선. |
| `grid` | `ChartGridStyle` | — | 그리드 스타일. |
| `padding` | `ChartPaddingOptions` | 자동 | 플롯 여백(CSS px). |
| `animation` | `ChartAnimationInput` | SDK 설정 | enter / update 애니메이션. |
| `width` | `number` | `168` | 플롯의 월드 너비. |
| `height` | `number` | `86` | 플롯의 월드 높이. |

`OhlcChartOptions`는 `hollowUp`, `wickWidth`, `bodyWidth`, `cornerRadius`를 뺀 같은 옵션을 받고, 다음을 추가합니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `lineWidth` | `number` | `1` | 줄기와 틱 선 두께(CSS px, 0.25–8). |
| `tickWidth` | `number` | `0.7` | 막대 간격에 대한 왼쪽 / 오른쪽 틱 합계 길이 비율(0.05–1). |

```ts
const { barCount } = sdk.renderOhlcChart({ t, open, high, low, close, volume }, {
  lineWidth: 1.5,
  tickWidth: 0.8,
  showVolume: true,
  yFit: 'visible',
  timeZone: 'UTC',
  axes: { y: { format: '$,.2f' } },
});
```

## 색 {#colors}

기본 색은 상승 캔들이 파랑, 하락 캔들이 주황입니다. 빨강과 초록만 쓰지 않으므로 색각 이상이 있어도 구분됩니다. 상승 캔들은 두 번째 단서로 기본으로 속이 비어 있습니다. 기본 색은 테마가 바뀌면 따라 바뀝니다.

## 집계 {#aggregation}

캔들이 2 CSS px보다 좁아지면 엔진이 3 px 버킷으로 집계합니다: 시가 = 첫 값, 고가 = 최댓값, 저가 = 최솟값, 종가 = 마지막 값, 거래량 = 합계. 극값은 보존되고, 캔들이 1,000,000개 이상이어도 상호작용이 가능합니다. 이때 툴팁은 버킷 값과 `count`를 보여 줍니다.

## 상호작용 {#interactions}

- 휠, 드래그, 핀치로 x축을 줌하고 팬합니다. 더블클릭은 초기화합니다. `setXRange(Date, Date)`로 코드에서 줌합니다.
- 십자선의 세로선은 캔들 위치에, 가로선은 포인터 위치에 놓입니다.
- 툴팁: `ctx.chartType`은 `'candlestick'` 또는 `'ohlc'`이고, `ctx.ohlc = { open, high, low, close, volume, x, xEnd, count }`입니다. 툴팁 필드 라벨(Open, High, Low, Close, Volume)은 차트 로케일을 따릅니다. [다국어 지원](../guide/i18n) 참고.
- 브러시 선택 `kind`는 `'candlestick'` 또는 `'ohlc'`이고, `ids`는 캔들 인덱스입니다.
- 주석은 x = `t`, y = 가격을 씁니다. [주석](../guide/annotations) 참고.
- 키보드 탐색, 데이터 표, CSV, 벡터 SVG 내보내기를 지원합니다.

[상호작용](../guide/interactions), [툴팁과 hover](../guide/tooltips) 참고.

## 데이터 갱신 {#updating-data}

새 배열로 `renderCandlestickChart` 또는 `renderOhlcChart`를 다시 호출합니다. OHLC 모드는 테마가 바뀌어도 유지됩니다.

## 프레임워크 {#frameworks}

```tsx
<CharturboChart type="candlestick" data={{ t, open, high, low, close }} />
<CharturboChart type="ohlc" data={{ t, open, high, low, close, volume }} options={{ tickWidth: 0.8 }} />
```

## 함께 보기 {#see-also}

- [선](./line)
- [숫자·날짜 형식](../guide/number-format)
- [다국어 지원](../guide/i18n)
