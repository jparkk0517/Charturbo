# 영역

영역 차트는 각 시리즈를 기준선까지 채웁니다. 겹친 영역, 누적 영역, 100% 누적 영역의 세 가지 모드를 지원합니다. 선 차트 엔진을 함께 쓰므로 데시메이션, 축, 줌, 시간 축이 똑같이 동작합니다. 시간에 따른 양이나 전체의 구성을 보여 줄 때 씁니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html#02-area-stacked)

## 기본 사용법 {#basic-usage}

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const day = 86_400_000;
const x = Array.from({ length: 180 }, (_, i) => Date.UTC(2026, 0, 1) + i * day);
sdk.renderAreaChart(
  [
    { name: '검색', values: search, x },
    { name: '소셜', values: social, x },
  ],
  { mode: 'stacked', title: '채널별 세션', axes: { x: { type: 'time' } } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderAreaChart(
  seriesList: LineSeriesDescriptor[],
  options?: AreaChartOptions
): { totalPoints: number; seriesCount: number }
```

## 데이터 형식 {#data-format}

시리즈는 [선](./line#data-format)과 같은 `LineSeriesDescriptor` 객체입니다: `name`, `values`, 선택 사항인 `x`, `color`, `lineWidth`, `marker`, `dash`, `curve`, `nulls`, `pieces`, `piecesBy`.

- 누적 모드(`'stacked'`, `'percent'`)에서는 시리즈 길이가 같아야 합니다. `x`를 주면 모든 시리즈의 `x`가 같아야 합니다. 아니면 예외를 던집니다.
- `NaN`은 자기 선과 영역에 빈틈을 남기고, 위쪽 시리즈에는 0으로 계산됩니다.
- 영역 차트는 `band`와 `yAxis`를 무시합니다(오른쪽 축 없음).

## 옵션 {#options}

`AreaChartOptions`는 `viewMode`를 뺀 모든 [선 차트 옵션](./line#options)을 받고(영역 차트는 2D만), 다음을 추가합니다.

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `mode` | `'overlap' \| 'stacked' \| 'percent'` | `'overlap'` | `'overlap'`은 각 시리즈를 0까지 채웁니다. `'stacked'`는 시리즈를 쌓습니다. `'percent'`는 쌓은 뒤 각 x에서 100%로 정규화합니다. |
| `fillOpacity` | `number` | overlap `0.2`, stacked / percent `0.8` | 시리즈 색에 곱하는 채우기 알파. |

## 모드 {#modes}

- `overlap`: 모든 시리즈를 0까지 채웁니다.
- `stacked`: 각 시리즈가 아래 시리즈 위에 놓입니다. 위쪽 가장자리에 선을 그립니다.
- `percent`: 각 x에서 보이는 시리즈의 합이 100%가 됩니다. 음수는 0으로 계산합니다. y 라벨에 `%`가 붙습니다.

값 축은 항상 0을 포함합니다. 곡선(`curve`)은 채우기에도 적용됩니다. 누적 영역의 아래 가장자리는 아래 시리즈의 곡선을 따르므로 빈틈이나 겹침이 없습니다.

`nulls: 'connect'`이면 누적 영역은 결측 값을 x를 따라 보간해 위쪽 시리즈를 받치고, 자기 마커는 그리지 않습니다.

## 구간 색칠 {#piecewise-colors}

```ts
sdk.renderAreaChart(
  [{ name: 'Load', values: load, pieces: [{ lte: 60, color: '#14b8a6' }, { gt: 60, color: '#ef4444' }] }],
  { mode: 'overlap' }
);
```

`pieces`는 [선 시리즈](./line#piecewise-colors)와 같은 방식으로 영역 시리즈에도 적용됩니다. 채우기는 구간 경계 사이의 띠로 잘립니다. y 구간(기본값)이면 ECharts 그라데이션처럼 높이 기준 가로 띠이고, stacked · percent 영역은 누적 높이로 판정합니다. `piecesBy: 'x'`이면 세로 띠입니다.

[라이브 예제](https://jparkk0517.github.io/Charturbo/line.html#12-pieces)

## 범례와 툴팁 {#legend-and-tooltips}

- 범례 항목을 클릭하면 시리즈가 숨겨지고 엔진이 나머지를 다시 쌓습니다. 범례 항목에 hover하면 다른 채우기와 선이 흐려집니다.
- 툴팁은 누적값이 아니라 시리즈의 원래 값을 보여 줍니다. `'stacked'`는 합계(`ctx.total`)를, `'percent'`는 각 비율(`item.percent`)을 추가합니다. `ctx.areaMode`에 모드가 들어 있습니다.
- hover 마커는 누적된 위쪽 가장자리에 놓입니다.

[툴팁과 hover](../guide/tooltips) 참고.

## 데이터 갱신 {#updating-data}

```ts
// 시리즈마다 청크 하나, 렌더링 순서대로
const lengths = sdk.appendAreaData(
  [
    { values: nextSearch, x: nextDays },
    { values: nextSocial, x: nextDays },
  ],
  { maxPoints: 4_000 }
);
sdk.render();
```

| 메서드 | 설명 |
|---|---|
| `appendAreaData(chunks, options?)` | 시리즈마다 청크 하나를 원자적으로 추가합니다. 각 시리즈에 남은 길이를 반환합니다. |
| `setSeriesData(seriesIndex, values, x?)` | 시리즈 하나를 교체합니다. 누적 모드에서는 새 데이터의 길이와 `x`가 다른 시리즈와 같아야 합니다. |
| `appendSeriesData(seriesIndex, values, x?, options?)` | `'overlap'`에서만 됩니다. 누적 모드에서는 예외를 던지므로 `appendAreaData`를 쓰세요. |

`appendAreaData` 규칙:

- 배치에는 숨긴 시리즈를 포함해 모든 시리즈가 있어야 합니다. 누적 모드에서는 모든 청크의 길이와 `x`가 같아야 합니다.
- `x` 없는 차트는 값만 받습니다. `x`가 있는 차트는 값마다 x(숫자 또는 `Date`) 하나가 필요합니다.
- 배치 전체를 먼저 검증합니다. 잘못된 배치는 아무것도 바꾸지 않습니다.
- `maxPoints`는 0..4294967295 범위의 정수입니다. 0이거나 생략하면 제한이 없습니다. 잘라 낸 뒤 id를 다시 계산합니다. 스타일, 범례 표시 상태, 줌은 유지합니다.
- stacked와 percent 모드는 갱신할 때마다 남은 샘플 전체에 대해 누적값을 다시 계산합니다(O(남은 샘플 수)). 큰 스트림에서는 배치 크기와 `maxPoints`를 조정하세요.

[실시간 스트리밍](../guide/streaming) 참고.

## 상호작용 {#interactions}

영역 차트는 2D 선 차트와 같은 상호작용을 지원합니다: 휠 줌, 드래그 팬, 터치 제스처, 브러시(선택 `kind`는 `'line'`), 주석, 내비게이터.

```ts
sdk.renderAreaChart(series, { mode: 'stacked', navigator: true });
```

[상호작용](../guide/interactions) 참고.

## 함께 보기 {#see-also}

- [선](./line)
- [밴드 · 범위](./band)
- [콤보](./combo)
- [실시간 스트리밍](../guide/streaming)
